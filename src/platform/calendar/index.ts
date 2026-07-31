/**
 * Platform · Working Calendar
 *
 * Thin wrappers over the database functions, which are the actual service. The
 * logic lives in SQL deliberately: a working day has to mean the same thing to
 * a handler, a constraint and a report, and duplicating it in TypeScript
 * guarantees the two eventually disagree.
 *
 * Attendance and Shift Management consume the same functions — this is a
 * platform service, not part of Leave.
 */

import { supabase } from "@/integrations/supabase/client";
import { toAppError, AppError } from "@/platform/errors";

export interface Holiday {
  id: string;
  name: string;
  holidayDate: string; // YYYY-MM-DD
}

/**
 * Working days between two dates, inclusive, honouring the organisation's
 * weekend and holiday configuration. Friday to Monday is 2 days when weekends
 * are excluded, not 4 (PRD Case 4).
 */
export async function getWorkingDays(
  organizationId: string,
  from: string,
  to: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("calculate_working_days", {
    _org_id: organizationId,
    _from: from,
    _to: to,
  });
  if (error) throw mapCalendarError(error, "getWorkingDays");
  return Number(data ?? 0);
}

/** Financial-year label, e.g. `2026-27` for an April start or `2026` for January. */
export async function getFinancialYear(organizationId: string, ref?: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_financial_year", {
    _org_id: organizationId,
    _ref: ref ?? undefined,
  });
  if (error) throw mapCalendarError(error, "getFinancialYear");
  return data as string;
}

/**
 * Today in the organisation's own timezone (D9).
 *
 * Never use the browser's date for a business rule: a device set to the wrong
 * timezone would let someone book leave the organisation considers to be in the
 * past, or be refused a date it considers future.
 */
export async function getOrgToday(organizationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("org_today", { _org_id: organizationId });
  if (error) throw mapCalendarError(error, "getOrgToday");
  return data as string;
}

/** Configured holidays, soonest first. RLS scopes this to the caller's organisation. */
export async function listHolidays(): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from("holidays")
    .select("id, name, holiday_date")
    .order("holiday_date", { ascending: true });

  if (error) throw toAppError(error, "listHolidays");

  return (data ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    holidayDate: h.holiday_date,
  }));
}

/**
 * The organisation's calendar and leave configuration, as an admin edits it.
 *
 * Typed columns rather than a JSONB bag, per D7: these feed generated columns
 * and every date calculation in the product, so integrity matters more than the
 * convenience of adding one without a migration.
 */
export interface OrgSettings {
  timezone: string;
  fyStartMonth: number;
  fyStartDay: number;
  /** 0 = Sunday. A six-day week is `[0]`; a five-day week is `[0, 6]`. */
  weekendDays: number[];
  excludeWeekends: boolean;
  excludeHolidays: boolean;
  allowRetroactive: boolean;
  defaultMinNoticeDays: number;
  /** D34 — how long before a financial year its leave becomes bookable. */
  nextFyOpensMonthsBefore: number;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
}

export async function getOrgSettings(): Promise<OrgSettings | null> {
  // The column list is a literal, not a constant. PostgREST infers the row type
  // from the string itself, and a `const` — however tidy — collapses it to
  // GenericStringError and takes every field's type with it.
  const { data, error } = await supabase
    .from("organization_settings")
    .select(
      "timezone, fy_start_month, fy_start_day, weekend_days, exclude_weekends, exclude_holidays, allow_retroactive, default_min_notice_days, next_fy_opens_months_before, session_idle_minutes, session_absolute_hours",
    )
    .maybeSingle();

  if (error) throw toAppError(error, "getOrgSettings");
  if (!data) return null;

  return {
    timezone: data.timezone,
    fyStartMonth: data.fy_start_month,
    fyStartDay: data.fy_start_day,
    weekendDays: data.weekend_days ?? [],
    excludeWeekends: data.exclude_weekends,
    excludeHolidays: data.exclude_holidays,
    allowRetroactive: data.allow_retroactive,
    defaultMinNoticeDays: data.default_min_notice_days,
    nextFyOpensMonthsBefore: data.next_fy_opens_months_before,
    sessionIdleMinutes: data.session_idle_minutes,
    sessionAbsoluteHours: data.session_absolute_hours,
  };
}

/**
 * Saves the configuration. RLS ("admins write settings") is what refuses a
 * non-admin; there is no check here, because a check here would imply the
 * policy is not trusted.
 *
 * Changing the weekend or the financial-year start changes what every existing
 * balance means. That is the customer's decision to make, and the screen says so
 * — but nothing here recalculates history, deliberately: silently rewriting days
 * people have already taken would be far worse than leaving them as booked.
 */
export async function saveOrgSettings(organizationId: string, s: OrgSettings): Promise<void> {
  const { error } = await supabase
    .from("organization_settings")
    .update({
      timezone: s.timezone,
      fy_start_month: s.fyStartMonth,
      fy_start_day: s.fyStartDay,
      weekend_days: s.weekendDays,
      exclude_weekends: s.excludeWeekends,
      exclude_holidays: s.excludeHolidays,
      allow_retroactive: s.allowRetroactive,
      default_min_notice_days: s.defaultMinNoticeDays,
      next_fy_opens_months_before: s.nextFyOpensMonthsBefore,
    })
    .eq("organization_id", organizationId);

  if (error) {
    // org_settings_weekend: a weekend cannot be every day of the week, or
    // calculate_working_days returns zero for every request ever made.
    if (error.message.includes("org_settings_weekend")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "A working week needs at least one working day.",
        400,
        { field: "weekendDays" },
      );
    }
    if (
      error.message.includes("org_settings_fy_day") ||
      error.message.includes("org_settings_fy_month")
    ) {
      throw new AppError("VALIDATION_FAILED", "That isn't a real date.", 400, {
        field: "fyStart",
      });
    }
    throw toAppError(error, "saveOrgSettings");
  }
}

export async function addHoliday(
  organizationId: string,
  name: string,
  holidayDate: string,
): Promise<void> {
  const { error } = await supabase
    .from("holidays")
    .insert({ organization_id: organizationId, name, holiday_date: holidayDate });

  if (error) {
    if (error.code === "23505") {
      throw new AppError("VALIDATION_FAILED", "There's already a holiday on that date.", 409, {
        field: "holidayDate",
      });
    }
    throw toAppError(error, "addHoliday");
  }
}

export async function removeHoliday(id: string): Promise<void> {
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) throw toAppError(error, "removeHoliday");
}

function mapCalendarError(error: { message?: string; code?: string }, context: string): AppError {
  const message = error.message ?? "";
  if (message.includes("TENANT_MISMATCH")) {
    return new AppError("TENANT_MISMATCH", "That workspace is not yours to read.", 403);
  }
  if (message.includes("NO_ORGANIZATION_SETTINGS")) {
    return new AppError("NOT_FOUND", "This workspace has no calendar configuration yet.", 404);
  }
  return toAppError(error, context);
}

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

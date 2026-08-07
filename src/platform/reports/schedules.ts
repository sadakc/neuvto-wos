/**
 * Platform · Scheduled reports
 *
 * Sada, 7 Aug 2026: "let the admin decide if the report should be triggered
 * automatically every week... There can also be a configuration where reports
 * can be triggered on a monthly basis by the end of the month... Let them decide
 * what date to pick when the report should be triggered to the admin's email,
 * to the CEO's email, etc."
 *
 * The platform owns WHEN and TO WHOM. It owns none of the content: a module
 * registers what it can send in `report_definitions` and renders its own email
 * from its own cron job (D30). Nothing here knows what a leave summary is, and
 * `reportKey` is an opaque string all the way down.
 *
 * Recipients are plain addresses rather than member ids, because the person who
 * wants the Monday email may have no account.
 */

import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";

export const CADENCES = ["weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

/** A report some module has said it can deliver by email. */
export interface ReportDefinition {
  key: string;
  title: string;
  description: string | null;
}

export interface ReportSchedule {
  id: string;
  reportKey: string;
  cadence: Cadence;
  /** ISO weekday, Monday = 1. Null unless weekly. */
  dayOfWeek: number | null;
  /** 1–31; 31 means the last day, whatever length the month is. Null unless monthly. */
  dayOfMonth: number | null;
  recipients: string[];
  isActive: boolean;
  /** The organisation's own date, not the server's. Null until it has run. */
  lastRunOn: string | null;
}

/**
 * Twenty is the database's ceiling too. Both exist: this one so the screen can
 * say so before the round trip, that one because a constraint is the only limit
 * a future caller cannot forget.
 */
export const MAX_RECIPIENTS = 20;

export const ScheduleInput = z
  .object({
    id: z.string().uuid().nullable().default(null),
    reportKey: z.string().min(1, "Choose a report"),
    cadence: z.enum(CADENCES),
    dayOfWeek: z.number().int().min(1).max(7).nullable().default(null),
    dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
    recipients: z
      .array(z.string().trim().email("That does not look like an email address"))
      .min(1, "Add at least one email address")
      .max(MAX_RECIPIENTS, `That is more than ${MAX_RECIPIENTS} addresses`),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    // The day belongs to the cadence. Without this a form that switched from
    // weekly to monthly would send a weekday the database then stores as null,
    // and the schedule would silently never fire.
    if (v.cadence === "weekly" && v.dayOfWeek == null) {
      ctx.addIssue({ code: "custom", path: ["dayOfWeek"], message: "Choose a day of the week" });
    }
    if (v.cadence === "monthly" && v.dayOfMonth == null) {
      ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Choose a day of the month" });
    }
  });

export type ScheduleInput = z.infer<typeof ScheduleInput>;

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** "1st", "2nd", "23rd", "31st" — English, and correct for the teens. */
export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * What will arrive and when, as a sentence.
 *
 * One definition rather than one per screen: the row, the confirmation and the
 * empty state all say the same thing, and 31 gets its explanation everywhere or
 * nowhere. "The 31st" is the only day that does not mean what it says — the
 * database clamps it to the length of the actual month, so a February report
 * arrives on the 28th rather than never.
 */
export function describeSchedule(s: {
  cadence: Cadence;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
}): string {
  if (s.cadence === "weekly") {
    const day = s.dayOfWeek == null ? "week" : WEEKDAYS[s.dayOfWeek - 1];
    return `Every ${day}, covering the week just finished and the week ahead`;
  }
  if (s.dayOfMonth === 31) {
    return "On the last day of every month, covering that month";
  }
  return `On the ${ordinal(s.dayOfMonth ?? 1)} of every month, covering the month just finished`;
}

/** "ceo@acme.com and 2 others" — the row has no room for twenty addresses. */
export function describeRecipients(recipients: string[]): string {
  if (recipients.length === 0) return "nobody";
  if (recipients.length === 1) return recipients[0];
  return `${recipients[0]} and ${recipients.length - 1} other${recipients.length === 2 ? "" : "s"}`;
}

// ───────────────────────────────────────────────────────────────── the database

export async function listReportDefinitions(): Promise<ReportDefinition[]> {
  const { data, error } = await supabase
    .from("report_definitions")
    .select("report_key, title, description")
    .order("title");
  if (error) throw toAppError(error, "listReportDefinitions");
  return (data ?? []).map((r) => ({
    key: r.report_key,
    title: r.title,
    description: r.description,
  }));
}

export async function listSchedules(): Promise<ReportSchedule[]> {
  const { data, error } = await supabase
    .from("report_schedules")
    .select(
      "id, report_key, cadence, day_of_week, day_of_month, recipients, is_active, last_run_on",
    )
    .order("created_at");
  if (error) throw toAppError(error, "listSchedules");
  return (data ?? []).map((r) => ({
    id: r.id,
    reportKey: r.report_key,
    cadence: r.cadence as Cadence,
    dayOfWeek: r.day_of_week,
    dayOfMonth: r.day_of_month,
    recipients: r.recipients ?? [],
    isActive: r.is_active,
    lastRunOn: r.last_run_on,
  }));
}

export async function saveSchedule(input: ScheduleInput): Promise<string> {
  // `undefined` and not `null`: the three optional arguments carry DEFAULT NULL
  // in SQL, so an omitted key takes the default. A literal null would be sent
  // over the wire and is what the generated types refuse — deliberately, since
  // "absent" and "explicitly nothing" are not the same request.
  const { data, error } = await supabase.rpc("report_schedule_save", {
    _report_key: input.reportKey,
    _cadence: input.cadence,
    _recipients: input.recipients,
    _id: input.id ?? undefined,
    _day_of_week: input.dayOfWeek ?? undefined,
    _day_of_month: input.dayOfMonth ?? undefined,
    _is_active: input.isActive,
  });
  if (error) throw mapScheduleError(error, "saveSchedule");
  return data as string;
}

export async function removeSchedule(id: string): Promise<void> {
  const { error } = await supabase.rpc("report_schedule_remove", { _id: id });
  if (error) throw mapScheduleError(error, "removeSchedule");
}

/**
 * A refusal from the database, as a sentence somebody can act on.
 *
 * The code is matched by prefix and NOT by extracting the text after a colon.
 * `BAD_EMAIL: someone@` carries the address that was rejected, and the version
 * of this that stripped everything up to the first colon is exactly the defect
 * that made "That didn't work. Please try again." the only message a leave
 * refusal ever produced (PR #63, 7 Aug 2026).
 */
function mapScheduleError(error: { message?: string }, context: string): AppError {
  const raw = (error.message ?? "").replace(/^ERROR:\s*/i, "").trim();

  if (raw.startsWith("REPORT_NOT_FOUND")) {
    return new AppError("NOT_FOUND", "That report is no longer available.", 404);
  }
  if (raw.startsWith("SCHEDULE_NOT_FOUND")) {
    return new AppError("NOT_FOUND", "That schedule no longer exists.", 404);
  }
  if (raw.startsWith("NO_RECIPIENTS")) {
    return new AppError("VALIDATION_FAILED", "Add at least one email address.", 400);
  }
  if (raw.startsWith("BAD_EMAIL")) {
    const address = raw.slice("BAD_EMAIL:".length).trim();
    return new AppError(
      "VALIDATION_FAILED",
      address
        ? `“${address}” does not look like an email address.`
        : "One of those does not look like an email address.",
      400,
    );
  }
  if (raw.startsWith("FORBIDDEN")) {
    return new AppError("FORBIDDEN", "Only an administrator can change this.", 403);
  }
  return toAppError(error, context);
}

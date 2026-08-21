/**
 * When a month is paid, and what a month's worth of days is.
 *
 * Pure, like the rest of this package: no database, no clock, no React. The
 * working calendar is passed in as a predicate rather than fetched, so the
 * awkward cases below are testable without a workspace existing.
 *
 * ── A deliberate divergence from the source spec ────────────────────────────
 *
 * The spec offers "On the last day of every month" or "On Day [N] of every
 * month" and never says WHICH month. For the last day it does not matter. For a
 * day number it decides everything: pay day 5 for the July run is either 5 July
 * — four weeks before July has finished being worked, so a salary credited
 * before it is earned — or 5 August. Only one of those is payroll.
 *
 * So the rule is stated in the type instead of inherited as an ambiguity:
 * `last_working_day` is the last working day of the month being paid, and
 * `day_of_next_month` is a numbered day of the month after it. Both are real
 * practice; neither can be read two ways.
 */

/** How proration counts a month, and when the money lands. */
export interface PaySchedule {
  /**
   * `actual_days` prorates against the real length of the month, so a day in
   * February is worth more than a day in March. `fixed_days` prorates against
   * the same number every month, so it never is.
   */
  readonly calculationMethod: "actual_days" | "fixed_days";
  /** Only read when `calculationMethod` is `fixed_days`. Conventionally 30. */
  readonly fixedDays: number;
  readonly payDateRule: "last_working_day" | "day_of_next_month";
  /** Only read when `payDateRule` is `day_of_next_month`. */
  readonly payDay: number;
}

export const DEFAULT_PAY_SCHEDULE: PaySchedule = {
  calculationMethod: "actual_days",
  fixedDays: 30,
  payDateRule: "last_working_day",
  payDay: 1,
};

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Day 0 of the following month is the last day of this one. */
const lastDayOf = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * The denominator proration divides by.
 *
 * This is the whole of `calculationMethod`'s effect, and it changes what people
 * are paid: on a 31-day month, `fixed_days: 30` pays 31/30 of a monthly salary
 * to somebody present throughout. That is a legitimate and common arrangement,
 * and it is the customer's to choose — but it is not a display preference, so
 * the screen that offers it says so.
 */
export function payableDaysBasis(schedule: PaySchedule, daysInMonth: number): number {
  return schedule.calculationMethod === "fixed_days" ? schedule.fixedDays : daysInMonth;
}

/**
 * The day this month's salary reaches a bank account.
 *
 * `periodMonth` is the first of the month being paid. `isNonWorking` answers
 * for a single date — a weekend under this organisation's working week, or one
 * of its holidays — and comes from the platform's working calendar, because a
 * workspace with two weekends eventually pays against one and counts leave
 * against the other.
 *
 * A pay date landing on a closed day moves BACKWARDS, per the spec: money
 * arriving early is an inconvenience to a finance team and money arriving late
 * is somebody's rent. Two edges worth naming:
 *
 *  - Day 31 of a 30-day month is not a date. The day is clamped to the length
 *    of the month it lands in rather than silently rolling into the next one,
 *    which would move a pay date a month.
 *  - If nothing in the preceding month is a working day — a misconfigured
 *    calendar, not a real one — the walk gives up and answers with the
 *    configured date. A wrong-but-stated date can be seen and corrected; a date
 *    thirty-one days adrift looks like a different bug entirely.
 */
export function resolvePayDate(
  periodMonth: string,
  schedule: PaySchedule,
  isNonWorking: (day: string) => boolean,
): string {
  const start = toUtc(periodMonth);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();

  const nominal =
    schedule.payDateRule === "last_working_day"
      ? new Date(Date.UTC(year, month, lastDayOf(year, month)))
      : new Date(Date.UTC(year, month + 1, Math.min(schedule.payDay, lastDayOf(year, month + 1))));

  let day = nominal;
  for (let back = 0; back < 31; back++) {
    if (!isNonWorking(iso(day))) return iso(day);
    day = new Date(day.getTime() - 86_400_000);
  }

  return iso(nominal);
}

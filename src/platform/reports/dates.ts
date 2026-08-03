/**
 * The two date calculations a report needs, kept pure so they can be tested.
 *
 * Both exist to keep the browser's own clock and timezone out of a report. The
 * migration behind these reports had to be fixed for exactly this: a subtraction
 * where only one side was org-local misreported a minute-old request as a day
 * old, every evening, for five and a half hours (D9). The same trap is one line
 * away on the client — `submitted_at.slice(0, 10)` is the UTC day, not the
 * workspace's.
 */

/**
 * "YYYY-MM-DD" for a timestamp, as the given timezone reckons it.
 *
 * Assembled from `formatToParts` rather than a locale that happens to produce
 * this shape: `en-CA` does, on most runtimes, and relying on that makes the
 * correctness of a payroll report a property of the ICU data that shipped with
 * somebody's browser.
 */
export function dateInZone(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The calendar month containing a day, as `{ from, to }` ISO dates.
 *
 * The default window for "what happened": payroll is run monthly, and a month is
 * the range somebody is most often about to type by hand.
 *
 * Arithmetic in UTC deliberately. `new Date(2026, 7, 1)` is midnight LOCAL, and
 * west of Greenwich that is the previous month — so the default range would
 * quietly start a day early for some of the people using it.
 */
export function monthBounds(isoDate: string): { from: string; to: string } {
  const [year, month] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/**
 * How the Employee Master writes dates, durations and counts. Pure, so the
 * card, the history tables and the directory cannot disagree about any of them.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2024-03-01` → `01 Mar 2024`. Read as a calendar date, never through a time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The last day of a closed row. The table stores an exclusive end (a row
 * closed "from 1 Mar" has effective_to = 1 Mar and last ran on 28 Feb), so
 * showing effective_to itself would claim one day too many.
 */
export function lastDay(exclusiveEnd: string | null | undefined): string | null {
  if (!exclusiveEnd) return null;
  const [y, m, d] = exclusiveEnd.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}

/** 40 → `3 yr 4 mo`; 11 → `11 mo`; 24 → `2 yr`. */
export function formatMonths(months: number | null | undefined): string {
  if (months == null || months < 0) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`;
}

/** Whole months from one calendar date to another (or to `today`). */
export function monthsBetween(from: string, to: string | null, today: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = (to ?? today).slice(0, 10).split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

const PLURAL: Record<string, string> = {
  son: "sons",
  daughter: "daughters",
  wife: "wives",
  husband: "husbands",
  father: "fathers",
  mother: "mothers",
  brother: "brothers",
  sister: "sisters",
  "father-in-law": "fathers-in-law",
  "mother-in-law": "mothers-in-law",
};

/**
 * `['son','son','daughter']` → `2 sons, 1 daughter`. Ordered by first
 * appearance, so the summary reads in the order the rows do.
 */
export function familySummary(relations: readonly string[]): string {
  if (relations.length === 0) return "Nobody recorded";
  const counts = new Map<string, number>();
  for (const r of relations) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].map(([r, n]) => `${n} ${n === 1 ? r : (PLURAL[r] ?? `${r}s`)}`).join(", ");
}

/** `full_time` → `Full time`; any unknown key keeps its words. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Today in the browser, as a calendar date. Durations only; nothing is decided on it. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** The running total, as the design writes it. */
export function shareTotal(rows: { share: string }[]): number {
  // Two decimals, the column's precision, so 33.33 × 3 reads 99.99, not 100.
  return Math.round(rows.reduce((s, r) => s + (Number(r.share) || 0), 0) * 100) / 100;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A calendar's weekly offs in words, Monday first: [0, 6] is "Saturday and Sunday off". */
export function describeWeek(weeklyOff: number[]): string {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => weeklyOff.includes(d)).map((d) => WEEKDAYS[d]);
  if (days.length === 0) return "No weekly off";
  const list =
    days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  return `${list} off`;
}

/** "20:00 to 08:00 next day, 30 min break": a shift ending before it starts ends the next day. */
export function describeShift(s: { startTime: string; endTime: string; breakMinutes: number }) {
  const start = s.startTime.slice(0, 5);
  const end = s.endTime.slice(0, 5);
  return `${start} to ${end}${end < start ? " next day" : ""}${
    s.breakMinutes ? `, ${s.breakMinutes} min break` : ""
  }`;
}

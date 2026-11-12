/**
 * How every module writes a date on screen (Core HR design): `2024-03-01` →
 * `01 Mar 2024`. Read as a calendar date, never through a time zone.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A span of days: `01 Mar 2024`, or `01 Mar 2024 to 03 Mar 2024`. */
export function formatRange(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`;
}

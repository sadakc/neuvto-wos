/**
 * Dates the tests can book without tripping notice periods or weekends: a
 * Tuesday some weeks ahead, which is a working day on every calendar the seed
 * has.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function tuesdayInWeeks(weeks: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

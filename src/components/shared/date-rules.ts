/**
 * What a whole date is (D104), for the date field and the forms that check
 * what it holds. Apart from the component so both can import it.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A whole, real calendar date in ISO form: not 2026-02-30, not half typed. */
export function isIsoDate(v: string): boolean {
  const m = ISO.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const DATE_FORMAT_MESSAGE = "Enter the date as DD/MM/YYYY, like 05/08/1990.";

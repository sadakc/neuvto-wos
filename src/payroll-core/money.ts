/**
 * Excel-compatible rounding.
 *
 * The payroll this replaces is a spreadsheet, and its output is checked against
 * this engine cell for cell. `Math.round` cannot be used for that: it rounds a
 * tie toward +Infinity, so `Math.round(-2.5)` is `-2` where Excel's `ROUND`
 * gives `-3`. Every difference of one rupee in a statutory return is a filing
 * that does not reconcile.
 *
 * Neither function takes a precision argument. All payroll money here is whole
 * rupees — every formula in the source workbook ends `ROUND(…, 0)` — and an
 * unused parameter is an invitation to introduce paise that nothing downstream
 * can hold.
 */

/** Excel `ROUND(value, 0)` — halves go away from zero. */
export function round0(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Excel `ROUNDUP(value, 0)` — away from zero, always.
 *
 * The `toFixed` is defensive, not demonstrated. Binary floating point cannot
 * represent 0.0075, so `earnedGross × 0.75%` looks like it should produce dust
 * — but a scan of every integer gross from 0 to 200,000 against all four rates
 * in `DEFAULT_POLICY` finds no case where the dust survives into a different
 * ceiling. The guard is kept because the rates are policy input rather than
 * constants: a future notification setting ESI to some rate that does divide
 * badly would otherwise charge an employee a rupee that does not exist.
 *
 * Nine decimals discards dust and keeps every real fraction, because no
 * genuine payroll figure carries nine decimal places.
 *
 * The rounding that IS exercised constantly is `round0` above, on proration —
 * `fixed ÷ daysInMonth × daysPayable` lands on an exact half all the time
 * (₹31 over 26.5 days is 26.5 precisely), which is why halves must go away
 * from zero rather than wherever `Math.round` sends them.
 */
export function roundUp0(value: number): number {
  const snapped = Number(value.toFixed(9));
  return snapped < 0 ? -Math.ceil(-snapped) : Math.ceil(snapped);
}

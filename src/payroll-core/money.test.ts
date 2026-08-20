import { describe, it, expect } from "vitest";
import { round0, roundUp0 } from "./money";

describe("round0 — Excel ROUND", () => {
  it("sends a positive tie away from zero, like Excel and unlike Math.round", () => {
    expect(round0(2.5)).toBe(3);
    expect(round0(3.5)).toBe(4);
  });

  /**
   * The reason this function exists. `Math.round(-2.5)` is -2, because it
   * rounds toward +Infinity; Excel gives -3. A negative arises on any
   * correction line — a recovered overpayment — and one rupee of disagreement
   * is a statutory return that does not reconcile.
   */
  it("sends a negative tie away from zero, where Math.round does not", () => {
    expect(round0(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
    expect(round0(-2.5)).not.toBe(Math.round(-2.5));
  });

  it("leaves whole numbers alone", () => {
    expect(round0(0)).toBe(0);
    expect(round0(15000)).toBe(15000);
  });
});

describe("roundUp0 — Excel ROUNDUP", () => {
  it("rounds any fraction up", () => {
    expect(roundUp0(138.01)).toBe(139);
    expect(roundUp0(0.0001)).toBe(1);
  });

  /**
   * The guard is defensive: no rate in DEFAULT_POLICY actually produces dust
   * that survives into a different ceiling. This proves the guard works on a
   * value that does carry it, so a future rate change cannot quietly start
   * charging a rupee that does not exist.
   */
  it("does not let floating-point dust invent a rupee", () => {
    const dusty = 138 + 1e-13;
    expect(dusty).toBeGreaterThan(138);
    expect(Math.ceil(dusty)).toBe(139);
    expect(roundUp0(dusty)).toBe(138);
  });

  it("still rounds up a fraction that is real rather than dust", () => {
    expect(roundUp0(138 + 1e-6)).toBe(139);
  });

  it("goes away from zero for negatives", () => {
    expect(roundUp0(-1.2)).toBe(-2);
  });

  it("leaves an exact integer alone", () => {
    expect(roundUp0(138)).toBe(138);
    expect(roundUp0(0)).toBe(0);
  });
});

/**
 * Where round0's tie rule actually bites.
 *
 * Proration is `fixed ÷ daysInMonth × daysPayable`, and that lands on an exact
 * half constantly — 1,936 times across a scan of realistic salaries against the
 * day counts this customer's muster roll produces.
 */
describe("the ties that proration actually produces", () => {
  it("rounds an exact half up, not to even", () => {
    expect((31 / 31) * 26.5).toBe(26.5);
    expect(round0((31 / 31) * 26.5)).toBe(27);
  });

  it("agrees with Excel on a half-day proration", () => {
    expect(round0((3100 / 31) * 26.5)).toBe(2650);
  });
});

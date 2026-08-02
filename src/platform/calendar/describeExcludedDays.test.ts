/**
 * The sentence that explains a day count.
 *
 * Sada applied for 10–15 August, counted six days, was charged five, and
 * reported it as broken arithmetic. Five was right: Acme works a six-day week,
 * so Saturday the 15th is a working day, but it is Independence Day. The screen
 * showed "Requested: 5" and said nothing else, and no employee is going to
 * reason their way from that to a public holiday.
 *
 * These are the cases that actually occur. The date formatter is injected so
 * the assertions do not depend on the machine's locale — a test that passes in
 * one timezone and fails in CI is worse than no test.
 */

import { describe, expect, it } from "vitest";
import { describeExcludedDays, type ExcludedDay } from ".";

const fmt = (iso: string) => `${Number(iso.slice(8, 10))} ${iso.slice(5, 7)}`;

const holiday = (day: string, label: string): ExcludedDay => ({ day, reason: "holiday", label });
const weekend = (day: string, label: string): ExcludedDay => ({ day, reason: "weekend", label });

describe("describeExcludedDays", () => {
  it("says nothing when every day counts", () => {
    // The strip must not grow an empty line for the ordinary case.
    expect(describeExcludedDays([], fmt)).toBe("");
  });

  it("names the holiday — the case that was reported as a bug", () => {
    expect(describeExcludedDays([holiday("2026-08-15", "Independence Day")], fmt)).toBe(
      "Not counted: 15 08 is Independence Day.",
    );
  });

  it("names a single non-working day by its own day name", () => {
    // "Saturday", not "weekend". On a six-day week only Sunday is off, and the
    // word "weekend" reads as two days to somebody who gets one.
    expect(describeExcludedDays([weekend("2026-08-15", "Saturday")], fmt)).toBe(
      "Not counted: 15 08 is a Saturday.",
    );
  });

  it("collapses several non-working days to a count", () => {
    // Listing six Sundays explains nothing "6 non-working days" doesn't.
    const many = [
      weekend("2026-08-02", "Sunday"),
      weekend("2026-08-09", "Sunday"),
      weekend("2026-08-16", "Sunday"),
    ];
    expect(describeExcludedDays(many, fmt)).toBe("Not counted: 3 non-working days.");
  });

  it("puts holidays before non-working days", () => {
    // The holiday is the surprise; the weekend is a rule they already know.
    const mixed = [weekend("2026-08-09", "Sunday"), holiday("2026-08-15", "Independence Day")];
    expect(describeExcludedDays(mixed, fmt)).toBe(
      "Not counted: 15 08 is Independence Day, 9 08 is a Sunday.",
    );
  });

  it("names every holiday, not just the first", () => {
    const two = [
      holiday("2026-08-15", "Independence Day"),
      holiday("2026-10-02", "Gandhi Jayanti"),
    ];
    expect(describeExcludedDays(two, fmt)).toBe(
      "Not counted: 15 08 is Independence Day, 2 10 is Gandhi Jayanti.",
    );
  });
});

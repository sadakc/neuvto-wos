/**
 * The pay date, in the months that are awkward.
 *
 * Every case here is one somebody would meet within a year of using this: a
 * pay date on a Sunday, a 31st that does not exist, the last day of a month
 * that happens to be a public holiday.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_SCHEDULE, payableDaysBasis, resolvePayDate } from "./schedule";
import type { PaySchedule } from "./schedule";

const always = () => false;
const schedule = (over: Partial<PaySchedule> = {}): PaySchedule => ({
  ...DEFAULT_PAY_SCHEDULE,
  ...over,
});

/** Saturdays and Sundays are closed. 2026-07-31 is a Friday. */
const weekendsOff = (day: string) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

describe("the last working day of the month being paid", () => {
  it("is the last calendar day when that day is worked", () => {
    // 31 July 2026 is a Friday.
    expect(resolvePayDate("2026-07-01", schedule(), weekendsOff)).toBe("2026-07-31");
  });

  it("steps back off a weekend rather than forward", () => {
    // 31 May 2026 is a Sunday. Money early inconveniences a finance team; money
    // late is somebody's rent.
    expect(resolvePayDate("2026-05-01", schedule(), weekendsOff)).toBe("2026-05-29");
  });

  it("steps back off a holiday too", () => {
    // The calendar's answer is one predicate, whatever the reason for the day
    // being closed.
    const closed = (d: string) => weekendsOff(d) || d === "2026-07-31";
    expect(resolvePayDate("2026-07-01", schedule(), closed)).toBe("2026-07-30");
  });

  it("finds February's end without being told how long February is", () => {
    // 2028 is a leap year; 29 February 2028 is a Tuesday.
    expect(resolvePayDate("2028-02-01", schedule(), weekendsOff)).toBe("2028-02-29");
  });
});

describe("a numbered day of the month after", () => {
  it("lands in the FOLLOWING month, not the one being paid", () => {
    // The whole reason this rule is spelled out in the type. July's salary paid
    // on "day 5" means 5 August; 5 July would be a salary credited before it
    // was earned.
    expect(
      resolvePayDate(
        "2026-07-01",
        schedule({ payDateRule: "day_of_next_month", payDay: 5 }),
        always,
      ),
    ).toBe("2026-08-05");
  });

  it("crosses the year boundary", () => {
    expect(
      resolvePayDate(
        "2026-12-01",
        schedule({ payDateRule: "day_of_next_month", payDay: 7 }),
        always,
      ),
    ).toBe("2027-01-07");
  });

  it("clamps a day the month does not have", () => {
    // Pay day 31, paying January, lands in February. Rolling over would move the
    // pay date into March — a whole month adrift from an off-by-one.
    expect(
      resolvePayDate(
        "2026-01-01",
        schedule({ payDateRule: "day_of_next_month", payDay: 31 }),
        always,
      ),
    ).toBe("2026-02-28");
  });

  it("still steps back off a closed day after clamping", () => {
    // 28 February 2026 is a Saturday.
    expect(
      resolvePayDate(
        "2026-01-01",
        schedule({ payDateRule: "day_of_next_month", payDay: 31 }),
        weekendsOff,
      ),
    ).toBe("2026-02-27");
  });
});

describe("when the calendar says nothing is ever open", () => {
  it("answers with the configured date rather than a date a month adrift", () => {
    // Not a real calendar — a misconfigured one. A wrong-but-stated date can be
    // seen and corrected; 31 days of silent walking looks like another bug.
    expect(resolvePayDate("2026-07-01", schedule(), () => true)).toBe("2026-07-31");
  });
});

describe("what a month's worth of days is", () => {
  it("follows the real month by default", () => {
    expect(payableDaysBasis(schedule(), 31)).toBe(31);
    expect(payableDaysBasis(schedule(), 28)).toBe(28);
  });

  it("uses the fixed figure when the organisation has chosen one", () => {
    const fixed = schedule({ calculationMethod: "fixed_days", fixedDays: 30 });
    // 31 days present against a 30-day denominator pays more than a full
    // month's salary. That is the customer's arrangement to choose, and the
    // reason the screen offering it says so out loud.
    expect(payableDaysBasis(fixed, 31)).toBe(30);
    expect(payableDaysBasis(fixed, 28)).toBe(30);
  });
});

import { describe, expect, it } from "vitest";
import {
  familySummary,
  formatDate,
  formatMonths,
  humanise,
  initials,
  monthsBetween,
} from "./format";

describe("employee formatting", () => {
  it("writes a calendar date without moving it through a time zone", () => {
    expect(formatDate("2024-03-01")).toBe("01 Mar 2024");
    expect(formatDate("2024-12-31T23:30:00Z")).toBe("31 Dec 2024");
    expect(formatDate(null)).toBe("—");
  });

  it("writes months as years and months", () => {
    expect(formatMonths(40)).toBe("3 yr 4 mo");
    expect(formatMonths(24)).toBe("2 yr");
    expect(formatMonths(11)).toBe("11 mo");
    expect(formatMonths(0)).toBe("0 mo");
    expect(formatMonths(undefined)).toBe("—");
  });

  it("counts whole months, and an open row runs to today", () => {
    expect(monthsBetween("2024-01-15", "2024-04-14", "2030-01-01")).toBe(2);
    expect(monthsBetween("2024-01-15", "2024-04-15", "2030-01-01")).toBe(3);
    expect(monthsBetween("2024-01-01", null, "2025-01-01")).toBe(12);
  });

  it("summarises family the way the design writes it, in row order", () => {
    expect(familySummary(["son", "daughter", "son"])).toBe("2 sons, 1 daughter");
    expect(familySummary(["mother"])).toBe("1 mother");
    expect(familySummary(["son", "son", "son"])).toBe("3 sons");
    expect(familySummary([])).toBe("Nobody recorded");
  });

  it("humanises a key and makes initials", () => {
    expect(humanise("full_time")).toBe("Full time");
    expect(initials("Priya Employee")).toBe("PE");
    expect(initials("Priya")).toBe("P");
    expect(initials(" ")).toBe("?");
  });
});

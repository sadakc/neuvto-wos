import { describe, expect, it } from "vitest";
import {
  describeShift,
  describeWeek,
  familySummary,
  formatDate,
  formatMonths,
  humanise,
  initials,
  lastDay,
  monthsBetween,
} from "./format";

describe("employee formatting", () => {
  it("writes a calendar date without moving it through a time zone", () => {
    expect(formatDate("2024-03-01")).toBe("01 Mar 2024");
    expect(formatDate("2024-12-31T23:30:00Z")).toBe("31 Dec 2024");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    // A date buried in other text is not a date.
    expect(formatDate("ref 2024-03-01")).toBe("—");
    // Every month by name, so none can go missing.
    expect(
      Array.from({ length: 12 }, (_, i) =>
        formatDate(`2024-${String(i + 1).padStart(2, "0")}-01`).slice(3, 6),
      ),
    ).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  it("writes months as years and months", () => {
    expect(formatMonths(40)).toBe("3 yr 4 mo");
    expect(formatMonths(24)).toBe("2 yr");
    expect(formatMonths(11)).toBe("11 mo");
    expect(formatMonths(0)).toBe("0 mo");
    expect(formatMonths(undefined)).toBe("—");
    expect(formatMonths(-1)).toBe("—");
  });

  it("counts whole months, and an open row runs to today", () => {
    expect(monthsBetween("2024-01-15", "2024-04-14", "2030-01-01")).toBe(2);
    expect(monthsBetween("2024-01-15", "2024-04-15", "2030-01-01")).toBe(3);
    expect(monthsBetween("2024-01-01", null, "2025-01-01")).toBe(12);
    // Timestamps are read as their calendar date.
    expect(monthsBetween("2024-01-15T10:00:00Z", "2024-04-15T09:00:00Z", "2030-01-01")).toBe(3);
    expect(monthsBetween("2024-01-15", null, "2024-04-15T09:00:00Z")).toBe(3);
    // ...including the day, which decides whether the last month is whole.
    expect(monthsBetween("2024-01-15T10:00:00Z", "2024-04-14", "2030-01-01")).toBe(2);
    expect(monthsBetween("2024-01-15", "2024-04-14T09:00:00Z", "2030-01-01")).toBe(2);
  });

  it("summarises family the way the design writes it, in row order", () => {
    expect(familySummary(["son", "daughter", "son"])).toBe("2 sons, 1 daughter");
    expect(familySummary(["mother"])).toBe("1 mother");
    expect(familySummary(["son", "son", "son"])).toBe("3 sons");
    expect(familySummary([])).toBe("Nobody recorded");
    // Each relation's plural, the irregular ones above all.
    const twice = (r: string) => familySummary([r, r]);
    expect(twice("daughter")).toBe("2 daughters");
    expect(twice("wife")).toBe("2 wives");
    expect(twice("husband")).toBe("2 husbands");
    expect(twice("father")).toBe("2 fathers");
    expect(twice("mother")).toBe("2 mothers");
    expect(twice("brother")).toBe("2 brothers");
    expect(twice("sister")).toBe("2 sisters");
    expect(twice("father-in-law")).toBe("2 fathers-in-law");
    expect(twice("mother-in-law")).toBe("2 mothers-in-law");
    expect(twice("cousin")).toBe("2 cousins");
  });

  it("humanises a key and makes initials", () => {
    expect(humanise("full_time")).toBe("Full time");
    expect(humanise(null)).toBe("—");
    expect(humanise("")).toBe("—");
    expect(initials("Priya Employee")).toBe("PE");
    expect(initials("Priya")).toBe("P");
    expect(initials(" ")).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials("priya k employee")).toBe("PE");
    expect(initials("  Priya  ")).toBe("P");
  });

  it("shows a closed row's last day, not its exclusive end", () => {
    expect(lastDay("2024-03-01")).toBe("2024-02-29");
    expect(lastDay("2025-01-01")).toBe("2024-12-31");
    expect(lastDay(null)).toBeNull();
    expect(lastDay("2024-03-01T00:00:00Z")).toBe("2024-02-29");
  });

  it("names every weekly off, Monday first", () => {
    expect(describeWeek([1, 2, 3, 4, 5, 6, 0])).toBe(
      "Monday, Tuesday, Wednesday, Thursday, Friday, Saturday and Sunday off",
    );
    expect(describeWeek([4])).toBe("Thursday off");
  });

  it("says a night shift ends the next day, and a day shift does not", () => {
    expect(describeShift({ startTime: "20:00:00", endTime: "08:00:00", breakMinutes: 30 })).toBe(
      "20:00 to 08:00 next day, 30 min break",
    );
    expect(describeShift({ startTime: "09:00:00", endTime: "18:00:00", breakMinutes: 60 })).toBe(
      "09:00 to 18:00, 60 min break",
    );
    // No break, no break wording.
    expect(describeShift({ startTime: "06:00", endTime: "14:00", breakMinutes: 0 })).toBe(
      "06:00 to 14:00",
    );
  });
});

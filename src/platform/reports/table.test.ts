/**
 * The half of a report that can be tested without rendering it.
 *
 * The suite runs in the node environment — no DOM, no React — so the columns are
 * declared as data and the table and the file are both built from that. What is
 * asserted here is what the export shares with the screen; the rest is markup.
 */

import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { reportHeaders, reportMatrix, type ReportColumn } from "./table";
import { dateInZone, monthBounds } from "./dates";

interface Row {
  days: number;
  name: string;
  department: string | null;
}

const COLUMNS: ReportColumn<Row>[] = [
  { header: "Employee", value: (r) => r.name },
  { header: "Department", value: (r) => r.department },
  { header: "Days", value: (r) => r.days, numeric: true },
];

describe("reportMatrix", () => {
  it("emits cells in the order the COLUMNS were declared, not the row's key order", () => {
    // `days` is first on the object and last in the report. A matrix built by
    // walking the object would come out in insertion order, so reordering two
    // lines in a handler would silently reorder a file somebody has a template
    // for — and nothing about that failure looks like a bug until a column of
    // names is summed.
    const matrix = reportMatrix(COLUMNS, [{ days: 3, name: "Ravi Kumar", department: "Ops" }]);
    expect(matrix).toEqual([["Ravi Kumar", "Ops", 3]]);
    expect(reportHeaders(COLUMNS)).toEqual(["Employee", "Department", "Days"]);
  });

  it("keeps the rows in the order they arrived", () => {
    // The pending report is sorted oldest-first in SQL and that ordering IS the
    // report — it exists to put what has been ignored longest at the top.
    const rows: Row[] = [
      { days: 9, name: "Ravi Kumar", department: "Ops" },
      { days: 1, name: "Asha Nair", department: "Ops" },
    ];
    expect(reportMatrix(COLUMNS, rows).map((r) => r[0])).toEqual(["Ravi Kumar", "Asha Nair"]);
  });

  it("writes an empty cell for a missing value rather than the word null", () => {
    // Somebody with no department is the common case in a workspace that has
    // not configured any. `String(null)` is "null", and a spreadsheet full of
    // the word null reads as data, not as absence.
    const csv = toCsv(
      reportHeaders(COLUMNS),
      reportMatrix(COLUMNS, [{ days: 2, name: "Asha Nair", department: null }]),
    );
    expect(csv).toBe("Employee,Department,Days\r\nAsha Nair,,2");
  });

  it("quotes a value that would otherwise become two columns", () => {
    const csv = toCsv(
      reportHeaders(COLUMNS),
      reportMatrix(COLUMNS, [{ days: 1, name: "Nayar, Reena", department: "Ops" }]),
    );
    expect(csv).toBe('Employee,Department,Days\r\n"Nayar, Reena",Ops,1');
  });
});

describe("dateInZone", () => {
  it("resolves a timestamp into the workspace's day, not the server's", () => {
    // 19:00 UTC is already tomorrow in Kolkata. This is the client-side form of
    // the bug the report migration had to be fixed for: `.slice(0, 10)` gives
    // the UTC day and is wrong for five and a half hours of every day.
    const evening = "2026-08-02T19:00:00Z";
    expect(evening.slice(0, 10)).toBe("2026-08-02");
    expect(dateInZone(evening, "Asia/Kolkata")).toBe("2026-08-03");
    expect(dateInZone(evening, "UTC")).toBe("2026-08-02");
  });

  it("goes backwards as well, for a workspace west of Greenwich", () => {
    expect(dateInZone("2026-08-03T02:00:00Z", "America/New_York")).toBe("2026-08-02");
  });
});

describe("monthBounds", () => {
  it("covers the whole month, including the last day", () => {
    // An exclusive or short end date drops the leave taken on the 31st, which is
    // a payday and one of the likelier days to be off.
    expect(monthBounds("2026-08-03")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthBounds("2026-04-15")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("gets February right in a leap year", () => {
    expect(monthBounds("2028-02-09")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("2026-02-09")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("pads a single-digit month, so the dates stay sortable and parseable", () => {
    expect(monthBounds("2026-01-31")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
});

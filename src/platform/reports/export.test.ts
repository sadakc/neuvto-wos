/**
 * Excel and PDF from a report (Leave phase 2, D94), read back rather than
 * compared with a string somebody wrote by hand.
 *
 * - the workbook opens in ExcelJS with the headers first, numbers as numbers,
 *   text as text (a comma in a name stays in one cell), and empty cells empty;
 * - the PDF is a PDF, and carries the title, the headers and every row;
 * - files are named for the report and the organisation's day, by extension.
 */

import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { reportFilename } from "./csv";
import { toPdf, toXlsx } from "./export";

const HEADERS = ["Employee", "Department", "Days"];
const ROWS = [
  ["Nayar, Reena", "Operations", 4.5],
  ["Ravi Kumar", null, 12],
];

describe("Excel", () => {
  it("reads back with the headers first, numbers as numbers and text whole", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toXlsx("Leave balances", HEADERS, ROWS));
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Leave balances");
    expect(ws.getRow(1).values).toEqual([undefined, ...HEADERS]);
    expect(ws.getCell(2, 1).value).toBe("Nayar, Reena");
    expect(ws.getCell(2, 3).value).toBe(4.5);
    expect(typeof ws.getCell(3, 3).value).toBe("number");
    expect(ws.getCell(3, 2).value).toBeNull();
    expect(ws.getRow(1).font?.bold).toBe(true);
  });

  it("keeps a sheet name Excel accepts", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toXlsx("Leave taken: 1/4 to 30/6 [all departments]", HEADERS, ROWS));
    expect(wb.worksheets[0].name).not.toMatch(/[:\\/?*[\]]/);
    expect(wb.worksheets[0].name.length).toBeLessThanOrEqual(31);
  });
});

describe("PDF", () => {
  it("is a PDF carrying the title, the headers and every row", async () => {
    const bytes = new Uint8Array(
      await toPdf("Leave balances", "Acme · 12 Oct 2026", HEADERS, ROWS),
    );
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    for (const s of ["Leave balances", "Acme", "Employee", "Nayar, Reena", "Ravi Kumar", "4.5"]) {
      expect(text).toContain(s);
    }
  });
});

describe("file names", () => {
  it("name the report, the day and the kind of file", () => {
    expect(reportFilename("leave-balances", "2026-10-12")).toBe("leave-balances-2026-10-12.csv");
    expect(reportFilename("leave-balances", "2026-10-12", "xlsx")).toBe(
      "leave-balances-2026-10-12.xlsx",
    );
    expect(reportFilename("leave-balances", "2026-10-12", "pdf")).toBe(
      "leave-balances-2026-10-12.pdf",
    );
  });
});

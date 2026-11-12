/**
 * The master template as an Excel file (D86), written and read with ExcelJS.
 * Loaded only when somebody downloads or uploads a template, so the library
 * is never in anybody else's page.
 *
 * Everything about WHAT is in the template is masterTemplate.ts; this file
 * only turns it into cells and back.
 */

import { DATE_HELP, MASTER_TEMPLATE, type Cell, type Grids } from "./masterTemplate";

/** The company's own lists, offered as drop-downs so a name cannot be misspelt. */
export interface CompanyLists {
  designations: string[];
  departments: string[];
  units: string[];
}

const ROWS = 2000;

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export async function buildTemplate(lists: CompanyLists): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Neuvto";

  // Lists live on a hidden tab: an inline list is limited to 255 characters,
  // which a company's designations outgrow.
  const listsSheet = wb.addWorksheet("Lists", { state: "veryHidden" });
  const named: Record<string, string> = {};
  const addList = (key: string, values: string[]) => {
    if (values.length === 0) return;
    const c = Object.keys(named).length + 1;
    values.forEach((v, i) => (listsSheet.getCell(i + 1, c).value = v));
    named[key] = `Lists!$${colLetter(c)}$1:$${colLetter(c)}$${values.length}`;
  };
  addList("designation", lists.designations);
  addList("department", lists.departments);
  addList("deployedUnit", lists.units);
  for (const tab of MASTER_TEMPLATE) {
    for (const col of tab.columns) {
      if (col.kind === "choice")
        addList(
          `${tab.key}.${col.key}`,
          col.options!.map(([l]) => l),
        );
    }
  }
  addList("yesno", ["Yes", "No"]);

  const help = wb.addWorksheet("Instructions");
  help.columns = [
    { header: "Tab", width: 22 },
    { header: "Column", width: 34 },
    { header: "Required", width: 10 },
    { header: "What to put", width: 90 },
  ];
  help.getRow(1).font = { bold: true };
  help.addRow([
    "",
    "",
    "",
    `One person is one row on People. Children, nominees and earlier employers are rows on their own tabs, as many as there are, linked by Employee code. Dates as ${DATE_HELP}: day, then month, then year. A date Excel already shows as a date is fine too. Aadhaar, PAN, bank account, religion, caste and disability are encrypted the moment they arrive.`,
  ]);
  for (const tab of MASTER_TEMPLATE) {
    help.addRow([tab.name, "", "", tab.purpose]).font = { bold: true };
    for (const col of tab.columns) {
      const what = [
        col.kind === "date" ? `A date, as ${DATE_HELP}.` : col.kind === "yesno" ? "Yes or No." : "",
        col.options ? `One of: ${col.options.map(([l]) => l).join(", ")}.` : "",
        col.help ?? "",
      ]
        .filter(Boolean)
        .join(" ");
      help.addRow([tab.name, col.header, col.required ? "Yes" : "", what]);
    }
  }

  for (const tab of MASTER_TEMPLATE) {
    const ws = wb.addWorksheet(tab.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = tab.columns.map((c) => ({
      header: c.required ? `${c.header} *` : c.header,
      width: Math.max(14, c.header.length + 4),
      // Text, not General: a 12-digit Aadhaar or an 18-digit account typed
      // into a General cell becomes a number and loses digits.
      style:
        c.kind === "date" ? { numFmt: "dd/mm/yyyy" } : c.kind === "number" ? {} : { numFmt: "@" },
    }));
    ws.getRow(1).font = { bold: true };
    // D106: the format on the date column's own heading, where it is filled in.
    tab.columns.forEach((c, i) => {
      if (c.kind === "date") ws.getCell(1, i + 1).note = `Write the date as ${DATE_HELP}.`;
    });
    tab.columns.forEach((c, i) => {
      const list =
        c.kind === "choice"
          ? named[`${tab.key}.${c.key}`]
          : c.kind === "yesno"
            ? named.yesno
            : tab.key === "people"
              ? named[c.key]
              : undefined;
      if (!list && c.kind !== "date") return;
      const letter = colLetter(i + 1);
      for (let r = 2; r <= ROWS; r++) {
        ws.getCell(`${letter}${r}`).dataValidation = list
          ? { type: "list", allowBlank: true, formulae: [list], showErrorMessage: true }
          : {
              type: "date",
              allowBlank: true,
              operator: "greaterThan",
              formulae: [new Date(1900, 0, 1)],
            };
      }
    });
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** A workbook's tabs as plain rows of plain values. */
export async function readWorkbook(data: ArrayBuffer): Promise<Grids> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const grids: Grids = {};
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cells[c - 1] = plain(cell.value);
      });
      rows[n - 1] = cells;
    });
    grids[ws.name] = Array.from(rows, (r) => r ?? []);
  });
  return grids;
}

function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== "object") return v as Cell;
  const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
  if ("result" in o) return plain(o.result);
  if (o.richText) return o.richText.map((t) => t.text).join("");
  if ("text" in o) return plain(o.text);
  return null;
}

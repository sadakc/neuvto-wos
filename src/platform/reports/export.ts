/**
 * A report as an Excel workbook or a PDF (Leave phase 2, D94), beside the CSV.
 *
 * Built from the same headers and cells as the table and the CSV (see
 * table.ts), so the three files cannot disagree with the screen or with each
 * other. Both libraries are loaded only when somebody asks for the file:
 * ExcelJS (MIT) is already the master template's, jsPDF and its table plugin
 * (MIT) are here for this alone. Nothing is paid for.
 *
 * Excel keeps numbers as numbers, so a column of days can be summed where it
 * lands. The PDF is landscape A4 with the title, a line saying whose and when,
 * and the table repeating its header on every page.
 */

import type { CsvValue } from "./csv";

/** Excel refuses some characters in a sheet name, and more than 31 of them. */
function sheetName(title: string): string {
  return (
    title
      .replace(/[:\\/?*[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Report"
  );
}

export async function toXlsx(
  title: string,
  headers: string[],
  rows: CsvValue[][],
): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(title));
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(r.map((v) => (v === undefined || v === "" ? null : v)));
  }
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 8), 60);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function toPdf(
  title: string,
  subtitle: string,
  headers: string[],
  rows: CsvValue[][],
): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: false });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.text(subtitle, 40, 56);
  autoTable(doc, {
    startY: 70,
    head: [headers],
    body: rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v)))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    margin: { left: 40, right: 40 },
  });
  return doc.output("arraybuffer");
}

function save(data: ArrayBuffer, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadXlsx(
  filename: string,
  title: string,
  headers: string[],
  rows: CsvValue[][],
): Promise<void> {
  save(
    await toXlsx(title, headers, rows),
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

export async function downloadPdf(
  filename: string,
  title: string,
  subtitle: string,
  headers: string[],
  rows: CsvValue[][],
): Promise<void> {
  save(await toPdf(title, subtitle, headers, rows), filename, "application/pdf");
}

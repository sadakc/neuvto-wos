/**
 * Turning a report into a file somebody opens in Excel.
 *
 * The mirror of `src/platform/auth/import.ts`, and it exists as its own module
 * for the same reason that one does: this is where a comma in a name quietly
 * becomes two columns. Step 13's parser tests enumerate the cases —
 * `"Nayar, Reena"`, `Ann "Annie" Shah`, CRLF — and every one of them is a way
 * to WRITE a broken file as much as to read one.
 *
 * The two are tested against each other rather than separately: a row written
 * here and parsed back by the importer must come out unchanged. Testing a
 * writer against a hand-written expected string only proves it agrees with
 * whoever wrote the expectation.
 */

/** A value as it should appear in one cell. Null and undefined become empty. */
export type CsvValue = string | number | null | undefined;

/**
 * Quotes one field, and only when it has to be quoted.
 *
 * Quoting everything would also be correct and is what most code does. It is
 * avoided here because a customer opening the file sees `"Ravi Kumar"` in every
 * cell and reasonably concludes the export is broken.
 */
function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);

  // A leading space or a trailing one survives a round trip only inside quotes;
  // most parsers, including ours, would otherwise keep it and later trim it in
  // an inconsistent place.
  const mustQuote =
    s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r") || s !== s.trim();

  if (!mustQuote) return s;
  // RFC 4180: a quote inside a quoted field is written twice.
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * A CSV file, header row first.
 *
 * CRLF because that is what RFC 4180 says and what Excel on Windows expects;
 * every parser worth using — including ours — accepts it.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

/**
 * Hands the file to the browser.
 *
 * A BOM is prepended deliberately. Without it Excel on Windows reads UTF-8 as
 * the local codepage, and a name like `Priyā` or a rupee sign arrives as
 * mojibake — which reads as data corruption rather than an encoding setting,
 * and is the kind of thing a customer reports as "your export mangled our
 * staff names".
 */
export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]): void {
  const blob = new Blob(["﻿" + toCsv(headers, rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * `leave-balances-2026-08-02.csv` — the report and the day it was taken.
 *
 * The date matters: these files end up attached to emails and sitting in
 * folders, and two exports a month apart are otherwise indistinguishable.
 * Takes the date rather than reading the clock, so the caller can pass the
 * organisation's own day (D9) instead of the browser's.
 */
export function reportFilename(slug: string, isoDate: string): string {
  return `${slug}-${isoDate}.csv`;
}

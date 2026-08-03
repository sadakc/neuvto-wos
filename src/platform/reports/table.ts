/**
 * A report's columns, declared once and used twice.
 *
 * The table on screen and the file the button writes are both rendered from the
 * same list, deliberately. Two lists — one in JSX, one assembled for the export
 * — is the shape that lets a column be added to the screen and forgotten in the
 * download, and the person who meets that is the one reconciling a spreadsheet
 * against the screen at the end of a month, who has no way to tell which of the
 * two is lying.
 *
 * Kept apart from `ReportView` because this half is pure and can be tested in
 * the node environment the suite runs in; the rendering half cannot.
 */

import type { CsvValue } from "./csv";

export interface ReportColumn<T> {
  header: string;
  /** The cell, on screen and in the file. One function, so the two cannot differ. */
  value: (row: T) => CsvValue;
  /** Right-aligns and tabulates. Numbers line up on the decimal point; names do not. */
  numeric?: boolean;
}

export function reportHeaders<T>(columns: ReportColumn<T>[]): string[] {
  return columns.map((c) => c.header);
}

/**
 * The rows as cells, in the order the columns were declared.
 *
 * Note what this does not do: read the row objects' own keys. A matrix built by
 * iterating an object comes out in insertion order — whatever the mapper
 * happened to write — so reordering two lines in a handler would silently
 * reorder the columns of a file somebody has a template for.
 */
export function reportMatrix<T>(columns: ReportColumn<T>[], rows: T[]): CsvValue[][] {
  return rows.map((row) => columns.map((c) => c.value(row)));
}

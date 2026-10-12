/** Reading an employee-records CSV. Pure, so it is tested without a screen. */

import { parseCsv } from "@/platform/auth";
import { IMPORT_COLUMNS, NEVER_IMPORTED } from "./contracts";

const KNOWN = new Set(IMPORT_COLUMNS.map(([c]) => c));
const normalise = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const TEMPLATE = IMPORT_COLUMNS.map(([c]) => c).join(",") + "\n";

export interface Parsed {
  fileName: string;
  /** The file's headers, and what each became. */
  headers: { raw: string; column: string; fate: "imported" | "never" | "unknown" }[];
  rows: Record<string, string>[];
}

/** Reads a CSV into rows of the columns we import; anything else is reported, not sent. */
export function readFile(fileName: string, text: string): Parsed {
  const grid = parseCsv(text);
  const header = (grid[0] ?? []).map((raw) => {
    const column = normalise(raw);
    const fate: "imported" | "never" | "unknown" = KNOWN.has(column)
      ? "imported"
      : NEVER_IMPORTED.includes(column)
        ? "never"
        : "unknown";
    return { raw, column, fate };
  });
  const rows = grid.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      const v = (cells[i] ?? "").trim();
      if (h.fate === "imported" && v !== "") row[h.column] = v;
    });
    return row;
  });
  return { fileName, headers: header, rows };
}

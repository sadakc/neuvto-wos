/**
 * The frame every report is rendered in — the table, and the button that saves
 * it.
 *
 * Owned by the platform rather than by whichever module reports, for the same
 * reason the Reports page itself is: this file knows nothing about leave, and a
 * second module contributing a report gets the export button, the empty state
 * and the mobile behaviour without writing any of them again.
 *
 * `rows` is the FILTERED set. The button writes exactly what is on screen, which
 * is the only behaviour an administrator can predict — a filter that narrows the
 * table but not the file is how somebody emails a payroll clerk four departments
 * they asked not to see.
 */

import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv, reportFilename } from "./csv";
import { reportHeaders, reportMatrix, type ReportColumn } from "./table";

interface ReportViewProps<T> {
  /** Filename stem: `leave-balances` becomes `leave-balances-2026-08-03.csv`. */
  slug: string;
  columns: ReportColumn<T>[];
  /** Already filtered. What is shown is what is exported. */
  rows: T[];
  rowKey: (row: T, index: number) => string;
  state: "loading" | "ready" | "error";
  /** Shown when the report ran and found nothing. Say why it might be empty. */
  empty: string;
  /** What went wrong, if it did. */
  error?: string;
  /** The report's own controls, rendered above the table. */
  filters?: ReactNode;
  /** The organisation's day (D9). Null while it loads, or if it could not be read. */
  today: string | null;
}

export function ReportView<T>({
  slug,
  columns,
  rows,
  rowKey,
  state,
  empty,
  error,
  filters,
  today,
}: ReportViewProps<T>) {
  const [query, setQuery] = useState("");

  // Built once and used for both, so the file cannot disagree with the table.
  const headers = reportHeaders(columns);
  const fullMatrix = useMemo(() => reportMatrix(columns, rows), [columns, rows]);

  /**
   * Search runs over the RENDERED cells, not the underlying row.
   *
   * That is the point rather than a shortcut: an administrator typing "finance"
   * means the word they can see, and matching the source objects would quietly
   * search fields the table does not show — finding a row for a reason nobody
   * can point at is worse than not finding it.
   *
   * It also keeps the export honest. This component's contract is that the
   * button writes exactly what is on screen, so the search has to narrow the
   * matrix the file is built from, not just the rows the table draws.
   */
  const { visibleRows, matrix } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { visibleRows: rows, matrix: fullMatrix };

    const keep: number[] = [];
    fullMatrix.forEach((cells, i) => {
      const hit = cells.some(
        (c) => c !== null && c !== undefined && String(c).toLowerCase().includes(q),
      );
      if (hit) keep.push(i);
    });
    return { visibleRows: keep.map((i) => rows[i]), matrix: keep.map((i) => fullMatrix[i]) };
  }, [query, rows, fullMatrix]);

  const searching = query.trim() !== "";
  const canExport = state === "ready" && visibleRows.length > 0 && today !== null;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        {filters}
        {/* Narrows what is already on screen, so it needs no round trip and no
            debounce — the rows are here. A report an administrator has to read
            top to bottom to find one person is a report they stop opening. */}
        <div className="min-w-48 flex-1">
          <label htmlFor={`${slug}-search`} className="block text-sm font-medium">
            Find somebody
          </label>
          <input
            id={`${slug}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, department, type…"
            data-testid={`${slug}-search`}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid={`${slug}-count`}>
          {state === "ready"
            ? searching
              ? // Both numbers, because "3 rows" under a search box leaves the
                // administrator wondering whether the rest are filtered out or
                // were never there.
                `${visibleRows.length} of ${rows.length} ${rows.length === 1 ? "row" : "rows"}`
              : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`
            : " "}
        </p>
        <button
          type="button"
          disabled={!canExport}
          data-testid={`${slug}-export`}
          title={
            today === null && state === "ready"
              ? "The workspace's date could not be read, so the file cannot be named."
              : undefined
          }
          onClick={() => {
            if (today === null) return;
            downloadCsv(reportFilename(slug, today), headers, matrix);
          }}
          className="inline-flex min-h-12 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {error && (
        <p role="alert" data-testid={`${slug}-error`} className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {state === "loading" && <div className="mt-4 h-64 animate-pulse rounded-lg bg-muted" />}

      {/* Two different nothings. "No pending approvals" is good news about the
          workspace; "nothing matches Priya" is a fact about the search box, and
          quite possibly a typo. Showing the report's own empty message to
          somebody who has just typed a name would answer a question they did
          not ask. */}
      {state === "ready" && rows.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      )}

      {state === "ready" && rows.length > 0 && visibleRows.length === 0 && (
        <p
          data-testid={`${slug}-no-match`}
          className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        >
          Nothing here matches “{query.trim()}”.
        </p>
      )}

      {state === "ready" && visibleRows.length > 0 && (
        // Reports are wide by nature and admin work is desktop-first, which is
        // why Reports sits past position five in the navigation. On a narrow
        // screen the table scrolls sideways rather than reflowing: a row of a
        // report is a record, and stacking its cells loses the alignment that
        // makes a column readable.
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.header}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 font-medium ${
                      c.numeric ? "text-right" : "text-left"
                    }`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRows.map((row, i) => (
                <tr key={rowKey(row, i)} data-testid={`${slug}-row`}>
                  {matrix[i].map((cell, j) => (
                    <td
                      key={columns[j].header}
                      className={`whitespace-nowrap px-3 py-2 ${
                        columns[j].numeric ? "text-right tabular-nums" : "text-left"
                      }`}
                    >
                      {cell === null || cell === undefined || cell === "" ? (
                        // An em dash rather than an empty cell: blank reads as a
                        // rendering fault, and these columns are legitimately
                        // empty — nobody has decided it yet, nobody is in a
                        // department. The FILE keeps the empty string.
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

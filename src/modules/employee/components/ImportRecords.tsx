/**
 * Bulk import of employee records (E8, bundle §7.7). Super Admin only.
 *
 * Dry run first, always: choosing a file reads it and asks the database what
 * is wrong, column by column, and writes nothing. Then one of two commits:
 * the clean rows now (the rest are listed to fix), or, when nothing needs
 * attention, everything. The database re-checks either way.
 *
 * Rows come in as DRAFTS. Inviting is a separate step on Add Employee, so a
 * file with a wrong email column cannot send two hundred invitations.
 *
 * Statutory columns are dropped here and named as dropped. A spreadsheet of
 * Aadhaar numbers is the file that leaks (D80).
 */

import { useState } from "react";
import { isAppError } from "@/platform/errors";
import { checkImport, commitImport, type ImportCheck } from "../handlers";
import { readFile, TEMPLATE, type Parsed } from "../importFile";
import { ModuleLink } from "@/platform/modules";

export default function ImportRecords() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [checks, setChecks] = useState<ImportCheck[] | null>(null);
  const [busy, setBusy] = useState<"check" | "commit" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);

  async function choose(file: File) {
    setError("");
    setDone(null);
    setChecks(null);
    const p = readFile(file.name, await file.text());
    setParsed(p);
    if (!p.headers.some((h) => h.column === "full_name")) {
      setError("The file needs a full_name column. Download the template to see the columns.");
      return;
    }
    if (p.rows.length === 0) {
      setError("The file has no rows under its header.");
      return;
    }
    setBusy("check");
    try {
      setChecks(await checkImport(p.rows));
    } catch (err) {
      setError(isAppError(err) ? err.message : "The file couldn't be checked.");
    } finally {
      setBusy(null);
    }
  }

  async function commit(onlyClean: boolean) {
    if (!parsed) return;
    setError("");
    setBusy("commit");
    try {
      setDone(await commitImport(parsed.rows, onlyClean));
    } catch (err) {
      setError(isAppError(err) ? err.message : "Nothing was imported.");
    } finally {
      setBusy(null);
    }
  }

  const bad = (checks ?? []).filter((c) => Object.keys(c.problems).length > 0);
  const clean = (checks?.length ?? 0) - bad.length;
  const perColumn = (column: string) => bad.filter((c) => column in c.problems).length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">
          Import employee records
        </h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          Bring a workforce in from a spreadsheet saved as CSV. Everybody comes in as a draft:
          nobody is invited until you send invitations from Add Employee. Nothing is written until
          you have seen what the file holds.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="neuvto-employee-records.csv"
          data-testid="import-template"
          className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
        >
          Download the template
        </a>
        <label className="inline-flex h-11 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          {parsed ? "Choose another file" : "Choose a file"}
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="import-file"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void choose(f);
              e.target.value = "";
            }}
          />
        </label>
        {parsed && <span className="text-sm text-muted-foreground">{parsed.fileName}</span>}
      </div>

      {error && (
        <p
          role="alert"
          data-testid="import-error"
          className="rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {parsed && (
        <section className="min-w-0 rounded-xl border border-border bg-card shadow-card">
          <h2 className="border-b border-border px-4 py-3 text-card-title font-semibold tracking-card-title">
            Columns
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-table-cell" data-testid="import-columns">
              <thead>
                <tr className="border-b border-border text-left">
                  {["In your file", "Becomes", "Result"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-table-header font-semibold tracking-table-header text-muted-foreground uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((h) => (
                  <tr
                    key={h.raw}
                    className="border-b border-border last:border-0"
                    data-testid="import-column-row"
                  >
                    <td className="px-4 py-2 font-mono">{h.raw}</td>
                    <td className="px-4 py-2">{h.fate === "imported" ? h.column : "—"}</td>
                    <td className="px-4 py-2">
                      {h.fate === "never"
                        ? "Not imported. Statutory and restricted data go in on each person's card, one at a time."
                        : h.fate === "unknown"
                          ? "Not a column we import; ignored."
                          : checks === null
                            ? "…"
                            : perColumn(h.column) === 0
                              ? "Every row is fine"
                              : `${perColumn(h.column)} ${perColumn(h.column) === 1 ? "row needs" : "rows need"} attention`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {busy === "check" && <p className="text-sm text-muted-foreground">Checking every row…</p>}

      {checks && !done && (
        <section
          className="rounded-xl border border-border bg-card p-4 shadow-card"
          data-testid="import-summary"
        >
          <p className="text-sm">
            <strong>{clean}</strong> of {checks.length}{" "}
            {checks.length === 1 ? "row is" : "rows are"} ready.
            {bad.length > 0 && <> {bad.length} need attention.</>}
          </p>
          {bad.length > 0 && (
            <ul
              className="mt-3 max-h-72 space-y-1 overflow-y-auto text-sm"
              data-testid="import-problems"
            >
              {bad.map((c) => (
                <li key={c.index}>
                  <span className="font-mono">Line {c.index + 1}</span>
                  {parsed?.rows[c.index - 1]?.full_name
                    ? ` (${parsed.rows[c.index - 1].full_name})`
                    : ""}
                  :{" "}
                  {Object.entries(c.problems)
                    .map(([col, msg]) => `${col}: ${msg}`)
                    .join("; ")}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {bad.length === 0 ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void commit(false)}
                data-testid="import-all"
                className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
              >
                {busy === "commit" ? "Importing…" : `Import all ${checks.length}`}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy !== null || clean === 0}
                  onClick={() => void commit(true)}
                  data-testid="import-clean"
                  className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                >
                  {busy === "commit"
                    ? "Importing…"
                    : `Import the ${clean} clean ${clean === 1 ? "row" : "rows"} now`}
                </button>
                <p className="self-center text-sm text-muted-foreground">
                  Or fix the {bad.length} in your file and choose it again.
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {done && (
        <p
          role="status"
          data-testid="import-done"
          className="rounded-lg border border-success-line bg-success-muted px-3.5 py-2.5 text-sm"
        >
          {done.created} {done.created === 1 ? "record" : "records"} imported as drafts
          {done.skipped > 0 ? `, ${done.skipped} skipped` : ""}.{" "}
          <ModuleLink path="employee/add" className="font-medium underline">
            Send their invitations from Add Employee
          </ModuleLink>
          .
        </p>
      )}
    </div>
  );
}

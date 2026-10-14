/**
 * Bringing a workforce in from the master template (D86). The Employee Admin.
 *
 * The template is Neuvto's own: one Excel workbook, People, Family, Nominees
 * and Previous employment, linked by Employee code, every field the record
 * keeps, Aadhaar, PAN and bank included. Downloaded here with the company's
 * own designations, departments and units as drop-downs.
 *
 * Dry run first, always: choosing a file reads it and asks the database, which
 * runs every person through the card's own writers and keeps nothing. Then the
 * whole file, or, if some people need attention, only the clean ones. The
 * database checks again either way.
 *
 * People come in as DRAFTS. Inviting is a separate step on Add Employee, so a
 * wrong email column cannot send two hundred invitations.
 */

import { useState } from "react";
import { isAppError } from "@/platform/errors";
import { listDepartments } from "@/platform/organization";
import { ModuleLink } from "@/platform/modules";
import { employeeErrorMessage } from "../contracts";
import {
  importMaster,
  listAllDesignations,
  listUnits,
  type ImportProblem,
  type ImportResult,
} from "../handlers";
import {
  DATE_HELP,
  forDatabase,
  headerFor,
  readGrids,
  tabName,
  type ReadProblem,
  type Workbook,
} from "../masterTemplate";
import { buildTemplate, readWorkbook } from "../masterWorkbook";

/** A problem, however it was found, as one line for the list. */
interface Line {
  where: string;
  column: string;
  message: string;
}

export default function ImportRecords() {
  const [fileName, setFileName] = useState("");
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [readProblems, setReadProblems] = useState<ReadProblem[]>([]);
  const [busy, setBusy] = useState<"template" | "check" | "commit" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<ImportResult | null>(null);

  async function downloadTemplate() {
    setError("");
    setBusy("template");
    try {
      const [designations, units, departments] = await Promise.all([
        listAllDesignations(),
        listUnits(),
        listDepartments().catch(() => []),
      ]);
      const data = await buildTemplate({
        designations: designations.filter((d) => d.status === "active").map((d) => d.name),
        departments: departments.map((d) => d.name),
        units: units.filter((u) => u.status === "active").map((u) => u.name),
      });
      const url = URL.createObjectURL(
        new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "neuvto-master-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(isAppError(err) ? err.message : "The template couldn't be made.");
    } finally {
      setBusy(null);
    }
  }

  async function choose(file: File) {
    setError("");
    setDone(null);
    setCheck(null);
    setReadProblems([]);
    setWorkbook(null);
    setFileName(file.name);
    setBusy("check");
    try {
      const { workbook: wb, problems } = readGrids(await readWorkbook(await file.arrayBuffer()));
      setWorkbook(wb);
      if (problems.length > 0) {
        setReadProblems(problems);
        return;
      }
      if (wb.people.length === 0) {
        setError("The People tab has nobody on it.");
        return;
      }
      setCheck(await importMaster(forDatabase(wb), false, false));
    } catch (err) {
      setError(
        isAppError(err)
          ? err.message
          : "That file couldn't be read. Save it as an Excel workbook (.xlsx) and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function commit(onlyClean: boolean) {
    if (!workbook) return;
    setError("");
    setBusy("commit");
    try {
      setDone(await importMaster(forDatabase(workbook), true, onlyClean));
    } catch (err) {
      setError(isAppError(err) ? err.message : "Nothing was imported.");
    } finally {
      setBusy(null);
    }
  }

  /** The row in Excel: the database counts rows sent, Excel counts from its header. */
  const sheetRow = (p: ImportProblem) =>
    workbook?.[p.tab]?.[p.row - 1]?.__sheetRow ?? String(p.row + 1);

  const lines: Line[] = [
    ...readProblems.map((p) => ({
      where: `${p.tab}${p.row ? `, row ${p.row}` : ""}`,
      column: p.column,
      message: p.message,
    })),
    ...(check?.problems ?? []).map((p) => ({
      where: `${tabName(p.tab)}, row ${sheetRow(p)}${p.employeeCode ? ` (${p.employeeCode})` : ""}`,
      column: headerFor(p.tab, p.column) || sectionName(p.section),
      message: employeeErrorMessage(p.code),
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">
          Import employee records
        </h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          Fill in Neuvto&apos;s master template: one row a person on People, and their family,
          nominees and earlier employers as rows on their own tabs, as many as there are. Everybody
          comes in as a draft, nobody is invited until you send invitations, and nothing is written
          until you have seen what the file holds. Aadhaar, PAN and bank numbers are encrypted the
          moment they arrive.
        </p>
        <p
          className="mt-2 max-w-prose text-sm text-foreground-secondary"
          data-testid="import-date-format"
        >
          <span className="font-medium text-foreground">Dates:</span> write them as {DATE_HELP}:
          day, then month, then year. The template&apos;s Instructions tab says what every column
          expects.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void downloadTemplate()}
          disabled={busy !== null}
          data-testid="import-template"
          className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-45"
        >
          {busy === "template" ? "Making the template…" : "Download the template"}
        </button>
        <label className="inline-flex h-11 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          {fileName ? "Choose another file" : "Choose a file"}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            data-testid="import-file"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void choose(f);
              e.target.value = "";
            }}
          />
        </label>
        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
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

      {busy === "check" && <p className="text-sm text-muted-foreground">Checking every person…</p>}

      {(check || readProblems.length > 0) && !done && (
        <section
          className="rounded-xl border border-border bg-card p-4 shadow-card"
          data-testid="import-summary"
        >
          {check ? (
            <p className="text-sm">
              <strong>{check.ready}</strong> of {check.people}{" "}
              {check.people === 1 ? "person is" : "people are"} ready.
              {check.skipped > 0 && <> {check.skipped} need attention.</>}
              {workbook && (
                <span className="text-muted-foreground">
                  {" "}
                  With {workbook.family.length} family{" "}
                  {workbook.family.length === 1 ? "member" : "members"}, {workbook.nominees.length}{" "}
                  {workbook.nominees.length === 1 ? "nominee" : "nominees"} and{" "}
                  {workbook.previous.length} earlier{" "}
                  {workbook.previous.length === 1 ? "employer" : "employers"}.
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm">
              The file couldn&apos;t be read as it is. Fix these and choose it again; nothing was
              sent.
            </p>
          )}

          {lines.length > 0 && (
            <ul
              className="mt-3 max-h-80 space-y-1 overflow-y-auto text-sm"
              data-testid="import-problems"
            >
              {lines.map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.where}</span>
                  {l.column ? `: ${l.column}` : ""}: {l.message}
                </li>
              ))}
            </ul>
          )}

          {check && (
            <div className="mt-4 flex flex-wrap gap-2">
              {check.problems.length === 0 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void commit(false)}
                  data-testid="import-all"
                  className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                >
                  {busy === "commit" ? "Importing…" : `Import all ${check.people}`}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy !== null || check.ready === 0}
                    onClick={() => void commit(true)}
                    data-testid="import-clean"
                    className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                  >
                    {busy === "commit"
                      ? "Importing…"
                      : `Import the ${check.ready} ready ${check.ready === 1 ? "person" : "people"} now`}
                  </button>
                  <p className="self-center text-sm text-muted-foreground">
                    Or fix the file and choose it again.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {done && (
        <p
          role="status"
          data-testid="import-done"
          className="rounded-lg border border-success-line bg-success-muted px-3.5 py-2.5 text-sm"
        >
          {done.created} {done.created === 1 ? "person" : "people"} imported as drafts
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

function sectionName(section: string | undefined): string {
  const names: Record<string, string> = {
    person: "The person",
    record: "The record",
    presentAddress: "Present address",
    permanentAddress: "Permanent address",
    posting: "Deployment",
    statutory: "Statutory numbers",
    bank: "Bank",
    restricted: "Religion, caste or disability",
    family: "Family",
    nominees: "Nominees",
    previous: "Previous employment",
  };
  return section ? (names[section] ?? "") : "";
}

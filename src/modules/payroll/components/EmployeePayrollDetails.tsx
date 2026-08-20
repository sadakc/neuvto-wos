/**
 * The numbers a payroll needs that are not money.
 *
 * UAN, ESI number, PAN, and where the salary is actually sent. Nothing here
 * enters the arithmetic — every figure on a payslip is computed without any of
 * it. What it does is make the output filable: the ECR needs a UAN per person,
 * the ESI return needs an insurance number, and the bank file needs an account
 * and an IFSC or the transfer simply fails.
 *
 * WHY EVERY FIELD IS OPTIONAL, AND WHY THE SCREEN STILL NAGS. Payroll is set up
 * over weeks and a person whose UAN has not come through yet is ordinary, so
 * refusing to save a half-filled form would make the screen unusable on day
 * one. But "optional" and "fine" are different things: a missing account number
 * is only discovered when somebody is not paid. So the row says what is
 * missing, in the words of the file that will reject it, at the time it can
 * still be fixed.
 *
 * The shapes are checked here because the database checks them too, and a form
 * that accepts what the database refuses produces an unexplained failure. An
 * eleven-digit UAN is the specific case worth stopping: the EPFO portal takes
 * the upload, then rejects the batch hours later without saying which row.
 */

import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import { listEmployeePayroll, saveEmployeePayroll } from "../handlers";
import { EmployeePayrollInput, type EmployeePayrollRow } from "../contracts";

/** What each identifier is for, in the words of the thing that consumes it. */
const FIELDS = [
  { key: "uan", label: "UAN", placeholder: "100200300400", needed: "the PF return" },
  { key: "esiNumber", label: "ESI number", placeholder: "3100123456", needed: "the ESI return" },
  { key: "pan", label: "PAN", placeholder: "ABCDE1234F", needed: "TDS" },
  { key: "bankName", label: "Bank", placeholder: "Canara Bank", needed: null },
  {
    key: "bankAccountNumber",
    label: "Account number",
    placeholder: "0123456789",
    needed: "the bank file",
  },
  { key: "bankIfsc", label: "IFSC", placeholder: "CNRB0001234", needed: "the bank file" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

/** Null in the database is an empty box on screen, not the word "null". */
function toDraft(row: EmployeePayrollRow): Record<FieldKey, string> {
  return {
    uan: row.uan ?? "",
    esiNumber: row.esiNumber ?? "",
    pan: row.pan ?? "",
    bankName: row.bankName ?? "",
    bankAccountNumber: row.bankAccountNumber ?? "",
    bankIfsc: row.bankIfsc ?? "",
  };
}

/** What this person would be left out of if a run happened now. */
function missingFrom(row: EmployeePayrollRow): string[] {
  const gaps: string[] = [];
  if (!row.uan) gaps.push("the PF return");
  if (!row.bankAccountNumber || !row.bankIfsc) gaps.push("the bank file");
  return gaps;
}

export default function EmployeePayrollDetails() {
  const [rows, setRows] = useState<EmployeePayrollRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<FieldKey, string> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setRows(await listEmployeePayroll());
    setState("ready");
  }

  useEffect(() => {
    load().catch((e) => {
      setError(isAppError(e) ? e.message : "We couldn't load your people.");
      setState("error");
    });
  }, []);

  const incomplete = useMemo(() => rows.filter((r) => missingFrom(r).length > 0), [rows]);

  function open(row: EmployeePayrollRow) {
    setError("");
    setOpenId(row.employeeId);
    setDraft(toDraft(row));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!openId || !draft) return;
    setError("");

    const parsed = EmployeePayrollInput.safeParse({ employeeId: openId, ...draft });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }

    setSaving(true);
    try {
      await saveEmployeePayroll(parsed.data);
      setOpenId(null);
      setDraft(null);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive-muted p-3 text-sm"
      >
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive-muted p-3 text-sm"
        >
          {error}
        </p>
      )}

      {/*
       * Named, never counted. "6 people are missing bank details" is a number an
       * administrator reads past; the person who does not get paid has a name.
       */}
      {incomplete.length > 0 && (
        <div
          role="status"
          data-testid="incomplete-details-warning"
          className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm"
        >
          <p className="font-medium">These people would be left out of a statutory file:</p>
          <ul className="mt-2 space-y-1">
            {incomplete.map((r) => (
              <li key={r.employeeId}>
                {r.employeeName ?? "Unnamed"} — missing from {missingFrom(r).join(" and ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nobody active in this workspace yet. Add people first — payroll details attach to the
          people already here.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.employeeId} className="p-3" data-testid={`person-${row.employeeId}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{row.employeeName ?? "Unnamed"}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.employeeCode ?? "no employee code"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {missingFrom(row).length === 0 ? (
                    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                      ready to file
                    </span>
                  ) : (
                    <span className="rounded-md bg-warning-muted px-2 py-1 text-xs">
                      missing from {missingFrom(row).join(" and ")}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => (openId === row.employeeId ? setOpenId(null) : open(row))}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    {openId === row.employeeId ? "Close" : "Edit"}
                  </button>
                </div>
              </div>

              {openId === row.employeeId && draft && (
                <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <label key={field.key} className="text-sm">
                      <span className="text-muted-foreground">{field.label}</span>
                      {field.needed && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          — needed for {field.needed}
                        </span>
                      )}
                      <input
                        value={draft[field.key]}
                        onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        aria-label={`${field.label} for ${row.employeeName ?? "this person"}`}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 font-mono"
                      />
                    </label>
                  ))}
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save details"}
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

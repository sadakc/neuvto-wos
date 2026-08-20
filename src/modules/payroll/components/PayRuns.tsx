/**
 * Running a month's payroll.
 *
 * One screen, four steps, in the order they actually happen: choose the month,
 * say how many days each person is being paid for, compute, submit. The
 * workbook this replaces spreads those across a muster roll, a salary register
 * and a mail merge; splitting them here would mean four screens to reconcile
 * when a number looks wrong.
 *
 * WHAT THIS SCREEN IS CAREFUL TO SAY: who is not being paid, and why. Anybody
 * without days entered is named above the table rather than counted, because
 * "43 of 44 computed" is the one message that reads as success while somebody
 * goes unpaid.
 */

import { useCallback, useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { computeRun, getRunInputs, listRuns, openRun, saveDays, submitRun } from "../handlers";
import type { PayRunSummary } from "../contracts";
import { monthLabel } from "./usePayRunReport";

interface Row {
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  daysPayable: number | null;
  hasStructure: boolean;
}

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default function PayRuns() {
  const [runs, setRuns] = useState<PayRunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [daysInMonth, setDaysInMonth] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const run = runs.find((r) => r.id === runId);
  const locked = run ? run.status !== "draft" : false;

  const loadRuns = useCallback(async () => {
    const list = await listRuns();
    setRuns(list);
    return list;
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const inputs = await getRunInputs(id);
    setDaysInMonth(inputs.daysInMonth);
    setRows(
      inputs.employees.map((e) => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        employeeCode: e.employeeCode,
        departmentName: e.departmentName,
        daysPayable: e.daysPayable,
        hasStructure: e.fixedComponents.length > 0,
      })),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadRuns();
        if (cancelled) return;
        const first = list[0]?.id ?? "";
        setRunId(first);
        if (first) await loadRun(first);
        if (!cancelled) setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load your pay runs.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRuns, loadRun]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't work. Please try again.");
    } finally {
      setBusy("");
    }
  }

  const open = () =>
    act("open", async () => {
      const id = await openRun(currentMonth());
      await loadRuns();
      setRunId(id);
      await loadRun(id);
    });

  const select = (id: string) =>
    act("select", async () => {
      setRunId(id);
      await loadRun(id);
    });

  const setDays = (employeeId: string, value: string) => {
    const days = value === "" ? null : Number(value);
    setRows((prev) =>
      prev.map((r) => (r.employeeId === employeeId ? { ...r, daysPayable: days } : r)),
    );
    if (days === null || Number.isNaN(days)) return;
    void act("days", async () => {
      await saveDays(runId, {
        employeeId,
        daysPayable: days,
        arrears: 0,
        tds: 0,
        lwf: 0,
        otherDeduction: 0,
      });
    });
  };

  const compute = () =>
    act("compute", async () => {
      const result = await computeRun(runId);
      await loadRuns();
      setNotice(
        `Computed ${result.employeesPaid} ${result.employeesPaid === 1 ? "person" : "people"} — ` +
          `${money(result.totals.netPayable)} net.`,
      );
    });

  const submit = () =>
    act("submit", async () => {
      await submitRun(runId);
      await loadRuns();
      setNotice("Sent for approval.");
    });

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  const awaiting = rows.filter((r) => r.daysPayable === null);
  const noStructure = rows.filter((r) => !r.hasStructure);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight">Pay runs</h1>
        <button
          onClick={open}
          disabled={busy !== ""}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === "open" ? "Opening…" : "Open this month"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive-muted p-3 text-sm"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-sm"
        >
          {notice}
        </p>
      )}

      {runs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No payroll has been run yet. Open this month to start.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => select(r.id)}
                aria-current={r.id === runId}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  r.id === runId ? "border-primary bg-accent" : "border-border"
                }`}
              >
                {monthLabel(r.periodMonth)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {r.status.replace("_", " ")}
                </span>
              </button>
            ))}
          </div>

          {run && (
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["People", String(run.employees)],
                ["Earned gross", money(run.earnedGross)],
                ["Deductions", money(run.totalDeduction)],
                ["Net payable", money(run.netPayable)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-muted p-3">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="font-display text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}

          {noStructure.length > 0 && (
            <p
              role="status"
              data-testid="no-structure-warning"
              className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm"
            >
              {noStructure.length} {noStructure.length === 1 ? "person has" : "people have"} no
              salary structure and cannot be paid:{" "}
              {noStructure.map((r) => r.employeeName ?? r.employeeCode ?? "unnamed").join(", ")}.
            </p>
          )}

          {awaiting.length > 0 && !locked && (
            <p
              role="status"
              data-testid="awaiting-days-warning"
              className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm"
            >
              Waiting on days for{" "}
              {awaiting.map((r) => r.employeeName ?? r.employeeCode ?? "unnamed").join(", ")}. They
              are left out of the run rather than paid a full month or nothing.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Days payable for each person in this pay run, out of {daysInMonth}
              </caption>
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th scope="col" className="p-2 text-left font-medium">
                    Employee
                  </th>
                  <th scope="col" className="p-2 text-left font-medium">
                    Code
                  </th>
                  <th scope="col" className="p-2 text-left font-medium">
                    Department
                  </th>
                  <th scope="col" className="p-2 text-right font-medium">
                    Days payable
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} className="border-b border-border last:border-0">
                    <td className="p-2">{r.employeeName ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">{r.employeeCode ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">{r.departmentName ?? "—"}</td>
                    <td className="p-2 text-right">
                      <label className="sr-only" htmlFor={`days-${r.employeeId}`}>
                        Days payable for {r.employeeName ?? r.employeeCode ?? "this person"}
                      </label>
                      <input
                        id={`days-${r.employeeId}`}
                        type="number"
                        step="0.5"
                        min="0"
                        max={daysInMonth}
                        disabled={locked}
                        value={r.daysPayable ?? ""}
                        onChange={(e) => setDays(r.employeeId, e.target.value)}
                        className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums disabled:opacity-50"
                      />
                      <span className="ml-1 text-xs text-muted-foreground">/ {daysInMonth}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={compute}
              disabled={busy !== "" || locked}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy === "compute" ? "Computing…" : "Compute"}
            </button>
            <button
              onClick={submit}
              disabled={busy !== "" || locked || !run?.employees}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === "submit" ? "Submitting…" : "Submit for approval"}
            </button>
            {locked && (
              <span className="text-sm text-muted-foreground">
                This run has been submitted and can no longer be changed.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

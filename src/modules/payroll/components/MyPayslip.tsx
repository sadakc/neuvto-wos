/**
 * Your own payslip.
 *
 * Reads `pay_run_lines` directly and gets exactly one person's rows back,
 * because that is what the policy allows — there is no "mine" filter here to
 * forget. A screen that filtered client-side would be one bug away from showing
 * a colleague's salary.
 *
 * Every figure is the one frozen at compute time. A payslip that re-derived
 * itself would change behind the person it was issued to the next time their
 * salary or their department did.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { getRunLines, listRuns } from "../handlers";
import type { PayRunSummary, PayslipLine } from "../contracts";
import { monthLabel } from "./usePayRunReport";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function MyPayslip() {
  const [runs, setRuns] = useState<PayRunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [line, setLine] = useState<PayslipLine | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Only approved runs. A draft is still being worked on, and a payslip
        // somebody screenshots before the numbers are final is a conversation
        // nobody in payroll wants to have twice.
        const list = (await listRuns()).filter(
          (r) => r.status === "approved" || r.status === "paid",
        );
        if (cancelled) return;
        setRuns(list);
        setRunId(list[0]?.id ?? "");
        if (list.length === 0) setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load your payslips.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      try {
        const lines = await getRunLines(runId);
        if (cancelled) return;
        setLine(lines[0] ?? null);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load that payslip.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (runs.length === 0 || !line) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-semibold tracking-tight">Payslips</h1>
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          You have no payslips yet. They appear here once a month&apos;s payroll has been approved.
        </p>
      </div>
    );
  }

  const deductions: [string, number][] = [
    ["Provident fund", line.pfEmployee],
    ["Employee state insurance", line.esiEmployee],
    ["Professional tax", line.professionalTax],
    ["Income tax", line.tds],
    ["Labour welfare fund", line.lwf],
    ["Other", line.otherDeduction],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight">Payslips</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Month</span>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {monthLabel(r.periodMonth)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">
          {line.daysPayable} of {line.daysPayable + line.ncpDays} days payable
          {line.departmentName ? ` · ${line.departmentName}` : ""}
        </p>

        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <section>
            <h2 className="font-display text-sm font-semibold">Earnings</h2>
            <dl className="mt-2 space-y-1 text-sm">
              {line.earned.map((c) => (
                <div key={c.code} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{c.code}</dt>
                  <dd className="tabular-nums">{money(c.amount)}</dd>
                </div>
              ))}
              {line.arrears > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Arrears</dt>
                  <dd className="tabular-nums">{money(line.arrears)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
                <dt>Earned gross</dt>
                <dd className="tabular-nums">{money(line.earnedGross)}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="font-display text-sm font-semibold">Deductions</h2>
            <dl className="mt-2 space-y-1 text-sm">
              {deductions.map(([label, amount]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">
                    {label === "Employee state insurance" && !line.esiEligible ? (
                      // Exempt is not zero, and the person reading this is the
                      // one most likely to ask why the line is blank.
                      <span className="text-muted-foreground">not applicable</span>
                    ) : (
                      money(amount)
                    )}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
                <dt>Total deductions</dt>
                <dd className="tabular-nums">{money(line.totalDeduction)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="mt-4 flex justify-between gap-4 border-t border-border pt-3">
          <p className="font-display font-semibold">Net pay</p>
          <p className="font-display text-xl font-semibold tabular-nums">
            {money(line.netPayable)}
          </p>
        </div>
      </div>
    </div>
  );
}

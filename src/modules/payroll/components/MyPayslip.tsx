/**
 * Your own payslip — and, for an employee, the whole of this module.
 *
 * Sada's rule: the salary slip, when it will be credited, and a copy to keep.
 * Nothing else. "Pay runs" is no longer offered to an employee at all, so this
 * is not one screen of several they are refused — it is the destination.
 *
 * Reads `pay_run_lines` directly. For an employee the policy hands back exactly
 * one row — their own — and the same policy enforces the administrator's
 * `payslipsVisible` switch (20260824100000), so when payslips are off this
 * screen is not hiding data it holds; it does not have it.
 *
 * FOR AN ADMINISTRATOR IT HANDS BACK EVERY ROW, and this screen used to take
 * the first of them. An administrator is also an employee, so opening their own
 * payslip showed whoever sorted first by employee code — Hema's payslip with
 * Alice's name and Alice's salary on it. Not a disclosure, since an
 * administrator may read every line anyway, but plainly wrong, and it took
 * seeding a workspace with more than one person to see it.
 *
 * So the line is now selected by identity rather than by position. That is not
 * a security filter and must not be mistaken for one — RLS is what refuses a
 * colleague's payslip to somebody who may not read it.
 *
 * Every figure is the one frozen at compute time. A payslip that re-derived
 * itself would change behind the person it was issued to the next time their
 * salary or their department did.
 *
 * The copy to keep is the browser's own print dialog: on every platform that
 * offers "Save as PDF", and no library, no dependency and no cost. The honest
 * limit is the filename — the person choosing where to save it names it, so a
 * payslip cannot carry the organisation's own naming the way a CSV can (D9).
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { getCurrentUser } from "@/platform/auth";
import { getPayDate, getPayrollSettings, getRunLines, listRuns } from "../handlers";
import type { PayRunSummary, PayrollSettings, PayslipLine } from "../contracts";
import { monthLabel } from "./usePayRunReport";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function MyPayslip() {
  const [runs, setRuns] = useState<PayRunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [line, setLine] = useState<PayslipLine | null>(null);
  const [payDate, setPayDate] = useState("");
  const [portal, setPortal] = useState<PayrollSettings["employeePortal"] | null>(null);
  const [slip, setSlip] = useState<PayrollSettings["payslip"] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Only approved runs. A draft is still being worked on, and a payslip
        // somebody screenshots before the numbers are final is a conversation
        // nobody in payroll wants to have twice.
        const [list, settings, user] = await Promise.all([
          listRuns(),
          getPayrollSettings(),
          getCurrentUser(),
        ]);
        if (cancelled) return;
        setMe(user?.id ?? null);
        const approved = list.filter((r) => r.status === "approved" || r.status === "paid");
        setRuns(approved);
        setPortal(settings.employeePortal);
        setSlip(settings.payslip);
        setRunId(approved[0]?.id ?? "");
        if (approved.length === 0) setState("ready");
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
        // By identity, not by position. An administrator is handed every line
        // in the run, and the first of them is somebody else's.
        setLine(lines.find((l) => l.employeeId === me) ?? null);
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
  }, [runId, me]);

  // The credit date, resolved against the organisation's own working calendar.
  // Allowed to fail quietly: a payslip without a date is still a payslip, and
  // this must never be the reason somebody cannot see what they were paid.
  useEffect(() => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !portal?.showPayDate) {
      setPayDate("");
      return;
    }
    let cancelled = false;
    getPayDate(run.periodMonth)
      .then((d) => !cancelled && setPayDate(d))
      .catch(() => !cancelled && setPayDate(""));
    return () => {
      cancelled = true;
    };
  }, [runId, runs, portal]);

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  // Switched off is not the same as not yet run, and saying "you have no
  // payslips" to somebody who has been paid for a year is the product telling
  // them something untrue. The database has already refused the figures; this
  // only explains the refusal.
  if (portal && !portal.payslipsVisible) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-semibold tracking-tight">Payslips</h1>
        <p
          data-testid="payslips-switched-off"
          className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        >
          Payslips aren&apos;t available through this workspace. Your administrator can turn them
          on, or send you one directly.
        </p>
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

  // An announcement stops showing on its own. A notice with no end date is how
  // "salary is late this month" is still on screen in March — so a date that
  // has passed hides it here rather than waiting for somebody to remember.
  const banner =
    portal?.bannerMessage &&
    (!portal.bannerUntil || portal.bannerUntil >= new Date().toISOString().slice(0, 10))
      ? portal.bannerMessage
      : "";

  const layout = slip?.layout ?? "standard";

  const statutory: [string, number][] = [
    ["Provident fund", line.pfEmployee],
    ["Employee state insurance", line.esiEmployee],
    ["Professional tax", line.professionalTax],
    ["Income tax", line.tds],
    ["Labour welfare fund", line.lwf],
    ["Other", line.otherDeduction],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-print="sheet">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight">Payslips</h1>

        <div className="flex items-center gap-2" data-print="hide">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Month</span>
            <select
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              className="h-12 rounded-md border border-input bg-background px-2 text-sm"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {monthLabel(r.periodMonth)}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => window.print()}
            data-testid="download-payslip"
            className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
          >
            Download PDF
          </button>
        </div>
      </div>

      {banner && (
        <p
          data-testid="portal-banner"
          role="status"
          data-print="hide"
          className="rounded-lg border border-border bg-secondary/40 p-4 text-sm"
        >
          {banner}
        </p>
      )}

      {/* Printed as well as shown: a payslip on paper has to say whose it is and
          which month it is, or it is a column of numbers. */}
      <div className="rounded-lg border border-border p-4" data-print="keep-together">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-base font-semibold">
            {line.employeeName ?? "Your payslip"}
          </p>
          <p className="text-sm text-muted-foreground">
            {monthLabel(runs.find((r) => r.id === runId)?.periodMonth ?? "")}
          </p>
        </div>

        {slip?.letterhead && (
          <p data-testid="payslip-letterhead" className="text-xs text-muted-foreground">
            {slip.letterhead}
          </p>
        )}

        {/* The month's own length, from the run — NOT `daysPayable + ncpDays`.
            Non-contributory days are ROUNDED for the PF return, so 29.5 days
            worked in a 31-day month gives an NCP of 2 and a payslip that read
            "29.5 of 31.5 days". A month with half a day extra in it is the kind
            of detail that makes somebody stop trusting the rest of the page. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {line.employeeCode ? `${line.employeeCode} · ` : ""}
          {line.daysPayable} of {runs.find((r) => r.id === runId)?.daysInMonth ?? "—"} days payable
          {line.departmentName ? ` · ${line.departmentName}` : ""}
        </p>

        {/* The first thing an employee actually wants to know. */}
        {payDate && (
          <p data-testid="pay-date" className="mt-3 text-sm">
            <span className="text-muted-foreground">Credited on </span>
            <span className="font-medium">{longDate(payDate)}</span>
          </p>
        )}

        {layout === "compact" ? (
          // One block, no breakdown. The gross and the deduction total are the
          // two figures that must never be missing, whatever the layout.
          <dl data-testid="payslip-compact" className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Earned gross</dt>
              <dd className="tabular-nums">{money(line.earnedGross)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total deductions</dt>
              <dd className="tabular-nums">{money(line.totalDeduction)}</dd>
            </div>
          </dl>
        ) : (
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
                {/* Itemised or not is the administrator's layout choice, and it is
                  only a layout choice: these are the reader's own figures either
                  way. The total is never hidden — a deduction with no
                  explanation and no total is just money gone. */}
                {/* Standing deductions are always itemised, whatever the
                  statutory-breakdown preference says. PF and ESI are statutory
                  and predictable; a canteen recovery is a number the person has
                  every reason to want explained, and hiding it leaves an
                  unexplained gap between gross and net. */}
                {line.deductions.map((d) => (
                  <div key={d.code} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{d.code}</dt>
                    <dd className="tabular-nums">{money(d.amount)}</dd>
                  </div>
                ))}
                {portal?.showStatutoryBreakdown !== false &&
                  statutory.map(([label, amount]) => (
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
        )}

        <div className="mt-4 flex justify-between gap-4 border-t border-border pt-3">
          <p className="font-display font-semibold">Net pay</p>
          <p className="font-display text-xl font-semibold tabular-nums">
            {money(line.netPayable)}
          </p>
        </div>

        {slip?.footerNote && (
          <p data-testid="payslip-footer" className="mt-4 text-2xs text-muted-foreground">
            {slip.footerNote}
          </p>
        )}
      </div>

      {(portal?.contactName || portal?.contactEmail) && (
        <p
          data-testid="payslip-contact"
          data-print="hide"
          className="text-sm text-muted-foreground"
        >
          Questions about your payslip: {portal.contactName}
          {portal.contactName && portal.contactEmail ? " · " : ""}
          {portal.contactEmail}
        </p>
      )}
    </div>
  );
}

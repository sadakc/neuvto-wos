/**
 * A pay run, as the person approving it sees it.
 *
 * TOTALS, NOT A LIST OF SALARIES. Approving a month's payroll is a decision
 * about an amount leaving the company, and it does not require reading what
 * each colleague earns — the RLS policy on `pay_run_lines` refuses that to
 * anybody but an administrator anyway, so a card that tried would render empty.
 *
 * The context comes from `approval_submit`, which this module wrote itself.
 */

import { useState } from "react";
import type { ModuleApprovalViewProps } from "@/platform/modules";
import { decideApproval } from "@/platform/approvals";
import { isAppError } from "@/platform/errors";
import { monthLabel } from "./usePayRunReport";

export default function PayRunApprovalCard({ item, onDecided }: ModuleApprovalViewProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const period = typeof item.context.periodMonth === "string" ? item.context.periodMonth : null;
  const employees = typeof item.context.employees === "number" ? item.context.employees : null;

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await decideApproval(item.approvalRequestId, decision);
      onDecided();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Payroll for {period ? monthLabel(period) : "a month"}</p>
        <p className="text-sm text-muted-foreground">
          {employees === null
            ? "Submitted by " + item.requesterName
            : `${employees} ${employees === 1 ? "person" : "people"} · submitted by ${item.requesterName}`}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Approving locks this run. The figures cannot be changed afterwards, and payslips become
        visible to everybody in it.
      </p>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive-muted p-2 text-sm"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => decide("approved")}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => decide("rejected")}
          disabled={busy}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
        >
          Send back
        </button>
      </div>
    </div>
  );
}

/**
 * The month selector every payroll report carries.
 *
 * It shows the status alongside the month because a draft run and an approved
 * one produce the same-looking PF return, and only one of them should be
 * uploaded to a government portal.
 */

import { monthLabel } from "./usePayRunReport";
import type { PayRunSummary } from "../contracts";

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  pending_approval: "awaiting approval",
  approved: "approved",
  paid: "paid",
};

export function RunPicker({
  runs,
  runId,
  onChange,
}: {
  runs: PayRunSummary[];
  runId: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Pay run</span>
      <select
        value={runId}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {monthLabel(r.periodMonth)} — {STATUS_LABEL[r.status] ?? r.status}
          </option>
        ))}
      </select>
    </label>
  );
}

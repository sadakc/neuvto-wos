/**
 * Approval turnaround (D94): every Leave decision in the window, how long it
 * waited at its level, who decided (a delegate, D92, is named), and whether it
 * had to move up (D87).
 */

import { dateInZone } from "@/platform/reports";
import { getApprovalTurnaround } from "../handlers";
import { WindowedReport } from "./WindowedReport";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function ApprovalTurnaroundReport() {
  return (
    <WindowedReport
      slug="approval-turnaround"
      title="Approval turnaround"
      fetch={getApprovalTurnaround}
      rowKey={(r) => r.stepId}
      empty="Nothing was decided in those dates."
      columns={(timeZone) => [
        { header: "Decided", value: (r) => dateInZone(r.decidedAt, timeZone) },
        { header: "What", value: (r) => capital(r.what) },
        { header: "Employee", value: (r) => r.employeeName },
        { header: "Level", value: (r) => r.level, numeric: true },
        { header: "Approver", value: (r) => r.approverName },
        { header: "Decided by", value: (r) => r.decidedByName },
        { header: "Decision", value: (r) => capital(r.decision) },
        { header: "Days at the level", value: (r) => r.daysTaken, numeric: true },
        { header: "Moved up", value: (r) => (r.movedUp ? "Yes" : "No") },
      ]}
    />
  );
}

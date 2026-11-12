/** The compensatory off register (D94): every claim made in the window, and what became of it. */

import { getCompOffRegister } from "../handlers";
import type { CompOffRegisterRow } from "../contracts";
import { WindowedReport } from "./WindowedReport";

const STATUS: Record<CompOffRegisterRow["status"], string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Withdrawn",
};

export default function CompOffRegisterReport() {
  return (
    <WindowedReport
      slug="comp-off-register"
      title="Compensatory off register"
      fetch={getCompOffRegister}
      rowKey={(r) => r.claimId}
      empty="No compensatory off was claimed in those dates."
      columns={() => [
        { header: "Submitted", value: (r) => r.submittedOn },
        { header: "Employee", value: (r) => r.employeeName },
        { header: "Department", value: (r) => r.departmentName },
        { header: "Type", value: (r) => r.leaveTypeName },
        { header: "Days worked", value: (r) => r.daysWorked },
        { header: "Days claimed", value: (r) => r.totalDays, numeric: true },
        { header: "Reason", value: (r) => r.reason },
        { header: "Status", value: (r) => STATUS[r.status] ?? r.status },
        { header: "Decided", value: (r) => r.decidedOn },
        { header: "Expires", value: (r) => r.expiresOn },
        { header: "Expired unused", value: (r) => r.expiredDays, numeric: true },
        { header: "Proof", value: (r) => (r.hasProof ? "Yes" : "No") },
      ]}
    />
  );
}

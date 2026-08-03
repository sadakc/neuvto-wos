/**
 * Pending approvals — what is stuck, and on whose desk.
 *
 * The platform's approvals queue answers this for the person reading it: it is
 * an approver's own inbox. This is the administrator's view of everybody's,
 * which is a different question — "why has nothing moved for nine days" is not
 * answerable from your own queue.
 *
 * Oldest first, decided in SQL. The report exists to surface what has been
 * ignored, so the thing that has waited longest is the first thing on screen,
 * and no filter is offered: a list of everything stuck is short by definition,
 * and if it is not, that is the finding.
 *
 * "Waiting on" names everyone who could act right now rather than the first of
 * them. A level can have more than one approver and any one unblocks it, so a
 * single name would send an administrator to chase the wrong person.
 *
 * There is no "submitted" column, deliberately. The timestamp is only meaningful
 * once resolved into the workspace's timezone, `days_waiting` is already that
 * number computed correctly in SQL, and the age is what the reader is here for.
 */

import { useEffect, useState } from "react";
import { ReportView, useOrgClock, type ReportColumn } from "@/platform/reports";
import { isAppError } from "@/platform/errors";
import { getLeavePendingReport } from "../handlers";
import type { LeavePendingReportRow } from "../contracts";

const COLUMNS: ReportColumn<LeavePendingReportRow>[] = [
  { header: "Waiting (days)", value: (r) => r.daysWaiting, numeric: true },
  { header: "Employee", value: (r) => r.employeeName },
  { header: "Department", value: (r) => r.departmentName },
  { header: "Leave type", value: (r) => r.leaveTypeName },
  { header: "From", value: (r) => r.fromDate },
  { header: "To", value: (r) => r.toDate },
  { header: "Working days", value: (r) => r.workingDays, numeric: true },
  // "1 of 2" rather than two columns: the question is how far through the chain
  // this is, and the two numbers only mean anything together.
  { header: "Level", value: (r) => `${r.currentLevel} of ${r.requiredLevels}` },
  { header: "Waiting on", value: (r) => r.waitingOn },
];

export default function LeavePendingReport() {
  const [rows, setRows] = useState<LeavePendingReportRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const { today } = useOrgClock();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getLeavePendingReport();
        if (cancelled) return;
        setRows(data);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load this report.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ReportView
      slug="leave-pending"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.leaveRequestId}
      state={state}
      error={error}
      today={today}
      empty="Nothing is waiting for a decision."
    />
  );
}

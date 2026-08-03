/**
 * Leave taken — what happened, for payroll and for the auditor.
 *
 * Every request OVERLAPPING the window, not every request starting inside it:
 * leave running from the 28th to the 3rd belongs in both months' reports, and
 * the request that straddles a boundary is exactly the one payroll asks about.
 *
 * Rejected and cancelled requests are included deliberately. "We have no record
 * of that" is the answer this report exists to prevent, and a request that was
 * refused is precisely the one somebody later disputes.
 *
 * The window defaults to the current month because payroll is monthly — and to
 * the current month in the WORKSPACE's timezone, not the browser's, which is
 * why nothing renders until the organisation's day is known.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ReportView,
  dateInZone,
  monthBounds,
  useOrgClock,
  type ReportColumn,
} from "@/platform/reports";
import { isAppError } from "@/platform/errors";
import { getLeaveTakenReport } from "../handlers";
import type { LeaveStatus, LeaveTakenReportRow } from "../contracts";

/**
 * Not shared with "My leave", which shows an employee "Declined". This report is
 * read alongside the database by somebody reconciling a payroll run, and the
 * word here should be the one the record actually holds.
 */
const STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function columns(timeZone: string): ReportColumn<LeaveTakenReportRow>[] {
  // Dates as ISO in both the table and the file. A range rendered "3 – 7 Aug"
  // reads well and is useless in the spreadsheet this ends up as, and the screen
  // and the file are deliberately one list.
  return [
    { header: "Employee", value: (r) => r.employeeName },
    { header: "Department", value: (r) => r.departmentName },
    { header: "Leave type", value: (r) => r.leaveTypeName },
    { header: "From", value: (r) => r.fromDate },
    { header: "To", value: (r) => r.toDate },
    { header: "Working days", value: (r) => r.workingDays, numeric: true },
    { header: "Status", value: (r) => STATUS_LABEL[r.status] ?? r.status },
    {
      header: "Submitted",
      value: (r) => (r.submittedAt ? dateInZone(r.submittedAt, timeZone) : null),
    },
    {
      header: "Decided",
      value: (r) => (r.decidedAt ? dateInZone(r.decidedAt, timeZone) : null),
    },
    { header: "Decided by", value: (r) => r.decidedBy },
    // Two columns, not one. They answer different questions — what was asked
    // for, and what the decision said — and the report used to carry a single
    // "Reason" that silently showed the employee's words on a REJECTED row.
    { header: "Decision note", value: (r) => r.decisionNote },
    { header: "Reason given", value: (r) => r.reason },
  ];
}

export default function LeaveTakenReport() {
  const { today, timeZone } = useOrgClock();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [rows, setRows] = useState<LeaveTakenReportRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  // The default window waits for the workspace's day. Seeding it from the
  // browser and correcting it later would fire a query for the wrong month and
  // show its results first.
  useEffect(() => {
    if (today && !range) setRange(monthBounds(today));
  }, [today, range]);

  const invalid = range !== null && range.to < range.from;

  useEffect(() => {
    if (!range || invalid) return;
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const data = await getLeaveTakenReport(range.from, range.to);
        if (cancelled) return;
        setRows(data);
        setError("");
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
  }, [range, invalid]);

  const cols = useMemo(() => columns(timeZone), [timeZone]);

  return (
    <ReportView
      slug="leave-taken"
      columns={cols}
      rows={invalid ? [] : rows}
      rowKey={(r) => r.leaveRequestId}
      state={invalid ? "ready" : state}
      // A backwards range is caught here rather than sent. The function returns
      // no rows for one, and an empty report and a mistyped date look identical.
      error={invalid ? "The end date is before the start date." : error}
      today={today}
      empty={
        invalid
          ? "Fix the dates to run this report."
          : "No leave overlaps those dates — including nothing rejected or cancelled."
      }
      filters={
        <>
          <label className="text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={range?.from ?? ""}
              disabled={!range}
              onChange={(e) => setRange((r) => (r ? { ...r, from: e.target.value } : r))}
              data-testid="taken-from"
              className="mt-1 block h-12 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-44"
            />
          </label>

          <label className="text-xs text-muted-foreground">
            To
            <input
              type="date"
              value={range?.to ?? ""}
              disabled={!range}
              onChange={(e) => setRange((r) => (r ? { ...r, to: e.target.value } : r))}
              data-testid="taken-to"
              className="mt-1 block h-12 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-44"
            />
          </label>
        </>
      }
    />
  );
}

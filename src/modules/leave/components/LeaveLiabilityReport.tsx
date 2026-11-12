/**
 * Leave liability (D94): what the company still owes in leave this year, in
 * days. Not yet taken (credited plus carried over, less taken), of which
 * already booked, and free to book. A value in money needs pay, which waits
 * for Payroll (D81); the report says so rather than leaving the column out
 * without a word.
 */

import { useEffect, useState } from "react";
import { ReportView, useOrgClock, type ReportColumn } from "@/platform/reports";
import { isAppError } from "@/platform/errors";
import { getLeaveLiability } from "../handlers";
import type { LeaveLiabilityRow } from "../contracts";

const COLUMNS: ReportColumn<LeaveLiabilityRow>[] = [
  { header: "Employee", value: (r) => r.employeeName },
  { header: "Department", value: (r) => r.departmentName },
  { header: "Leave type", value: (r) => r.leaveTypeName },
  { header: "Year", value: (r) => r.fyLabel },
  { header: "Not yet taken", value: (r) => r.notTakenDays, numeric: true },
  { header: "Already booked", value: (r) => r.bookedDays, numeric: true },
  { header: "Free to book", value: (r) => r.freeDays, numeric: true },
];

export default function LeaveLiabilityReport() {
  const { today } = useOrgClock();
  const [rows, setRows] = useState<LeaveLiabilityRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLeaveLiability()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load this report.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        This year&apos;s leave still owed, in days, not money: a value needs pay, which comes with
        Payroll. Unpaid leave owes nothing and is not listed.
      </p>
      <ReportView
        slug="leave-liability"
        title="Leave liability"
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => `${r.employeeId}:${r.leaveTypeName}`}
        state={state}
        error={error}
        today={today}
        empty="Nobody is owed any leave this year."
      />
    </div>
  );
}

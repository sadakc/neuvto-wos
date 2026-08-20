/**
 * The ESI return — only the people actually covered.
 *
 * THE EXEMPT ARE FILTERED OUT, NOT SHOWN AS ZERO. In the workbook they are
 * rows of noughts, which is how somebody eventually files a return declaring
 * forty-four members when eleven are covered. Who is exempt is a fact this
 * screen states above the table instead.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportView, type ReportColumn } from "@/platform/reports";
import { RunPicker } from "./RunPicker";
import { usePayRunReport } from "./usePayRunReport";
import type { PayslipLine } from "../contracts";

interface EsiRow extends PayslipLine {
  esiNumber: string | null;
}

const COLUMNS: ReportColumn<EsiRow>[] = [
  { header: "ESI number", value: (r) => r.esiNumber },
  { header: "Employee code", value: (r) => r.employeeCode },
  { header: "Employee", value: (r) => r.employeeName },
  { header: "Days payable", value: (r) => r.daysPayable, numeric: true },
  { header: "Earned gross", value: (r) => r.earnedGross, numeric: true },
  { header: "Employee 0.75%", value: (r) => r.esiEmployee, numeric: true },
  { header: "Employer 3.25%", value: (r) => r.esiEmployer, numeric: true },
  { header: "Total", value: (r) => r.esiEmployee + r.esiEmployer, numeric: true },
];

export default function EsiReport() {
  const { runs, runId, setRunId, lines, state, error, today } = usePayRunReport();
  const [rows, setRows] = useState<EsiRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payroll_employee_details")
        .select("employee_id, esi_number")
        .is("deleted_at", null);
      if (cancelled) return;
      const byEmployee = new Map((data ?? []).map((d) => [d.employee_id, d.esi_number]));
      setRows(
        lines
          .filter((l) => l.esiEligible)
          .map((l) => ({ ...l, esiNumber: byEmployee.get(l.employeeId) ?? null })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const exempt = lines.length - rows.length;

  return (
    <ReportView
      slug="esi"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.employeeId}
      state={state}
      error={error}
      today={today}
      empty="Nobody in this pay run is covered by ESI."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <RunPicker runs={runs} runId={runId} onChange={setRunId} />
          {exempt > 0 && (
            <p className="text-sm text-muted-foreground">
              {exempt} {exempt === 1 ? "person is" : "people are"} above the wage ceiling and not in
              this return.
            </p>
          )}
        </div>
      }
    />
  );
}

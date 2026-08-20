/**
 * The PF return, in the columns the EPFO's ECR expects.
 *
 * Column names are the portal's, not ours — GROSS WAGES, EPF WAGES, NCP DAYS —
 * because whoever uploads this is matching them against a spec written by
 * somebody else, and a friendlier heading is a heading they have to translate.
 *
 * The file this produces is a CSV. THE ACTUAL ECR UPLOAD IS #~# DELIMITED, and
 * converting is one step somebody still does by hand. Recorded rather than
 * hidden: the workbook this replaces produces the same CSV and the same manual
 * step, so nothing is lost, but nothing should be claimed either.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportView, type ReportColumn } from "@/platform/reports";
import { RunPicker } from "./RunPicker";
import { usePayRunReport } from "./usePayRunReport";
import type { PayslipLine } from "../contracts";

interface PfRow extends PayslipLine {
  uan: string | null;
}

const COLUMNS: ReportColumn<PfRow>[] = [
  { header: "UAN", value: (r) => r.uan },
  { header: "MEMBER NAME", value: (r) => r.employeeName },
  { header: "GROSS WAGES", value: (r) => r.earnedGross, numeric: true },
  { header: "EPF WAGES", value: (r) => r.pfWages, numeric: true },
  { header: "EPS WAGES", value: (r) => r.pfWages, numeric: true },
  { header: "EDLI WAGES", value: (r) => r.pfWages, numeric: true },
  { header: "EPF CONTRI REMITTED", value: (r) => r.pfEmployee, numeric: true },
  { header: "EPS CONTRI REMITTED", value: (r) => r.eps, numeric: true },
  { header: "EPF EPS DIFF REMITTED", value: (r) => r.epsDifference, numeric: true },
  { header: "NCP DAYS", value: (r) => r.ncpDays, numeric: true },
  // Hand-entered in the workbook and not modelled here. The column stays so the
  // file's shape matches what the portal expects; an absent column is a failed
  // upload, and a zero is what the workbook sends today.
  { header: "REFUND OF ADVANCES", value: () => 0, numeric: true },
];

export default function PfReport() {
  const { runs, runId, setRunId, lines, state, error, today } = usePayRunReport();
  const [rows, setRows] = useState<PfRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payroll_employee_details")
        .select("employee_id, uan")
        .is("deleted_at", null);
      if (cancelled) return;
      const byEmployee = new Map((data ?? []).map((d) => [d.employee_id, d.uan]));
      setRows(lines.map((l) => ({ ...l, uan: byEmployee.get(l.employeeId) ?? null })));
    })();
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const missing = rows.filter((r) => !r.uan).length;

  return (
    <ReportView
      slug="pf-ecr"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.employeeId}
      state={state}
      error={error}
      today={today}
      empty="Nothing has been computed for this month yet."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <RunPicker runs={runs} runId={runId} onChange={setRunId} />
          {missing > 0 && (
            <p className="text-sm text-warning">
              {missing} {missing === 1 ? "person has" : "people have"} no UAN. The portal rejects
              those rows on upload.
            </p>
          )}
        </div>
      }
    />
  );
}

/**
 * What each department cost this month.
 *
 * Derived from the pay run's own lines rather than stored, which is the whole
 * argument for this module existing. The workbook keeps three copies of this
 * summary and they disagree: `summary` calls a department Engineering,
 * `Sheet1` calls the identical row HR DEPARTMENT, and `Sheet9` says HR
 * department — same seven people, same ₹155,500, three names, because two of
 * them are pivot caches nobody refreshed after a rename.
 *
 * People with no department are their own row, not dropped. A summary whose
 * rows do not add up to the run is a summary nobody can reconcile.
 */

import { ReportView, type ReportColumn } from "@/platform/reports";
import { RunPicker } from "./RunPicker";
import { usePayRunReport } from "./usePayRunReport";
import type { PayslipLine } from "../contracts";

interface DepartmentRow {
  departmentName: string | null;
  employees: number;
  daysPayable: number;
  fixedGross: number;
  earnedGross: number;
  totalDeduction: number;
  netPayable: number;
}

const COLUMNS: ReportColumn<DepartmentRow>[] = [
  { header: "Department", value: (r) => r.departmentName ?? "No department" },
  { header: "People", value: (r) => r.employees, numeric: true },
  { header: "Days payable", value: (r) => r.daysPayable, numeric: true },
  { header: "Fixed gross", value: (r) => r.fixedGross, numeric: true },
  { header: "Earned gross", value: (r) => r.earnedGross, numeric: true },
  { header: "Total deduction", value: (r) => r.totalDeduction, numeric: true },
  { header: "Net payable", value: (r) => r.netPayable, numeric: true },
];

function summarise(lines: PayslipLine[]): DepartmentRow[] {
  const groups = new Map<string | null, DepartmentRow>();
  for (const line of lines) {
    const row = groups.get(line.departmentName) ?? {
      departmentName: line.departmentName,
      employees: 0,
      daysPayable: 0,
      fixedGross: 0,
      earnedGross: 0,
      totalDeduction: 0,
      netPayable: 0,
    };
    row.employees += 1;
    row.daysPayable += line.daysPayable;
    row.fixedGross += line.fixedGross;
    row.earnedGross += line.earnedGross;
    row.totalDeduction += line.totalDeduction;
    row.netPayable += line.netPayable;
    groups.set(line.departmentName, row);
  }
  return [...groups.values()].sort((a, b) =>
    (a.departmentName ?? "￿").localeCompare(b.departmentName ?? "￿"),
  );
}

export default function DepartmentSummaryReport() {
  const { runs, runId, setRunId, lines, state, error, today } = usePayRunReport();
  const rows = summarise(lines);

  return (
    <ReportView
      slug="department-summary"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.departmentName ?? "none"}
      state={state}
      error={error}
      today={today}
      empty="Nothing has been computed for this month yet."
      filters={<RunPicker runs={runs} runId={runId} onChange={setRunId} />}
    />
  );
}

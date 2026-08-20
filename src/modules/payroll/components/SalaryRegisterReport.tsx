/**
 * The salary register — every person, every figure, for one month.
 *
 * This is the sheet the whole workbook is built around, and the one every other
 * output is derived from. It is a report rather than a second screen: the pay
 * run itself already shows these numbers while they are being worked on, and
 * this is the copy that gets exported, emailed and filed.
 */

import { ReportView, type ReportColumn } from "@/platform/reports";
import { RunPicker } from "./RunPicker";
import { usePayRunReport } from "./usePayRunReport";
import type { PayslipLine } from "../contracts";

const COLUMNS: ReportColumn<PayslipLine>[] = [
  { header: "Employee code", value: (r) => r.employeeCode },
  { header: "Employee", value: (r) => r.employeeName },
  { header: "Department", value: (r) => r.departmentName },
  { header: "Fixed gross", value: (r) => r.fixedGross, numeric: true },
  { header: "Days payable", value: (r) => r.daysPayable, numeric: true },
  { header: "Arrears", value: (r) => r.arrears, numeric: true },
  { header: "Earned gross", value: (r) => r.earnedGross, numeric: true },
  { header: "PF wages", value: (r) => r.pfWages, numeric: true },
  { header: "PF", value: (r) => r.pfEmployee, numeric: true },
  // Exempt is not zero, and the file has to say which. A column of noughts
  // cannot distinguish "outside ESI" from "computed as nothing", and the
  // workbook this replaces cannot either.
  { header: "ESI", value: (r) => (r.esiEligible ? r.esiEmployee : "exempt"), numeric: true },
  { header: "Professional tax", value: (r) => r.professionalTax, numeric: true },
  { header: "TDS", value: (r) => r.tds, numeric: true },
  { header: "LWF", value: (r) => r.lwf, numeric: true },
  { header: "Other deduction", value: (r) => r.otherDeduction, numeric: true },
  { header: "Total deduction", value: (r) => r.totalDeduction, numeric: true },
  { header: "Net payable", value: (r) => r.netPayable, numeric: true },
];

export default function SalaryRegisterReport() {
  const { runs, runId, setRunId, lines, state, error, today } = usePayRunReport();
  return (
    <ReportView
      slug="salary-register"
      columns={COLUMNS}
      rows={lines}
      rowKey={(r) => r.employeeId}
      state={state}
      error={error}
      today={today}
      empty="Nothing has been computed for this month yet."
      filters={<RunPicker runs={runs} runId={runId} onChange={setRunId} />}
    />
  );
}

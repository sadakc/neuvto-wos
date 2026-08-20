/**
 * Professional tax — Karnataka.
 *
 * THE STATE IS NAMED, AND THAT IS THE POINT OF THIS SCREEN EXISTING. The
 * workbook's PT sheet is Form 5A under the ANDHRA PRADESH Professions Tax Act
 * 1987, while the establishment is in Karnataka, its muster roll is Form 22
 * under the Karnataka Shops Rules 1963, and the slab actually applied — ₹200
 * above ₹24,999 — is Karnataka's. A Karnataka deduction on an Andhra return.
 *
 * Only the people who paid it appear. A return listing everybody with most at
 * nought is a return whose headcount means nothing.
 */

import { ReportView, type ReportColumn } from "@/platform/reports";
import { RunPicker } from "./RunPicker";
import { usePayRunReport } from "./usePayRunReport";
import type { PayslipLine } from "../contracts";

const COLUMNS: ReportColumn<PayslipLine>[] = [
  { header: "Employee code", value: (r) => r.employeeCode },
  { header: "Employee", value: (r) => r.employeeName },
  { header: "Earned gross", value: (r) => r.earnedGross, numeric: true },
  { header: "Professional tax", value: (r) => r.professionalTax, numeric: true },
];

export default function PtReport() {
  const { runs, runId, setRunId, lines, state, error, today } = usePayRunReport();
  const liable = lines.filter((l) => l.professionalTax > 0);
  const total = liable.reduce((t, l) => t + l.professionalTax, 0);

  return (
    <ReportView
      slug="professional-tax-karnataka"
      columns={COLUMNS}
      rows={liable}
      rowKey={(r) => r.employeeId}
      state={state}
      error={error}
      today={today}
      empty="Nobody in this pay run earned above the professional tax threshold."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <RunPicker runs={runs} runId={runId} onChange={setRunId} />
          <p className="text-sm text-muted-foreground">
            Karnataka — ₹200 above ₹24,999. {liable.length} liable, ₹{total.toLocaleString("en-IN")}{" "}
            payable.
          </p>
        </div>
      }
    />
  );
}

/**
 * Absenteeism (D94): approved leave inside the window, per person. Separate
 * absences, working days inside the window, of which unpaid, and the Bradford
 * factor (absences × absences × days), which weighs many short absences above
 * one long one. Highest first.
 */

import { getAbsenteeism } from "../handlers";
import { WindowedReport } from "./WindowedReport";

export default function AbsenteeismReport() {
  return (
    <WindowedReport
      slug="absenteeism"
      title="Absenteeism"
      fetch={getAbsenteeism}
      rowKey={(r) => r.employeeId}
      empty="Nobody had approved leave in those dates."
      note="Approved leave only, counted in working days inside the dates chosen. Bradford factor: absences × absences × days."
      columns={() => [
        { header: "Employee", value: (r) => r.employeeName },
        { header: "Department", value: (r) => r.departmentName },
        { header: "Absences", value: (r) => r.spells, numeric: true },
        { header: "Days", value: (r) => r.days, numeric: true },
        { header: "Of which unpaid", value: (r) => r.unpaidDays, numeric: true },
        { header: "Bradford factor", value: (r) => r.bradfordFactor, numeric: true },
      ]}
    />
  );
}

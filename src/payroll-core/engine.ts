/**
 * The payroll arithmetic.
 *
 * Pure: no database, no network, no clock, no React. Given the same input it
 * returns the same output forever, which is what lets `engine.test.ts` assert
 * every figure of a real month against the spreadsheet this replaces.
 *
 * The rules are the source workbook's, reproduced deliberately rather than
 * corrected — see `docs/product/NEUVTO_PAYROLL.md` for the four places they
 * diverge from statute and why each is left alone for now.
 */

import { round0, roundUp0 } from "./money";
import type {
  ComponentDefinition,
  EmployeeInput,
  PayRunResult,
  PayrollLine,
  PayrollPolicy,
  PayrollTotals,
  DepartmentTotals,
} from "./types";

/** The statutory position as at FY 2026-27, Karnataka. */
export const DEFAULT_POLICY: Omit<PayrollPolicy, "daysInMonth"> = {
  pfWageCeiling: 15000,
  pfRate: 0.12,
  epsRate: 0.0833,
  esiGrossCeiling: 21000,
  esiEmployeeRate: 0.0075,
  esiEmployerRate: 0.0325,
  ptThreshold: 24999,
  ptAmount: 200,
};

export function computeEmployee(
  employee: EmployeeInput,
  components: readonly ComponentDefinition[],
  policy: PayrollPolicy,
): PayrollLine {
  const amountOf = (code: string) =>
    employee.fixedComponents.find((c) => c.code === code)?.amount ?? 0;

  const fixedGross = employee.fixedComponents.reduce((sum, c) => sum + c.amount, 0);

  // Proration is by calendar day. A July salary and a February salary therefore
  // differ for identical attendance, which is what the workbook does and what
  // the customer's staff already expect to see.
  const earned = [...components]
    .sort((a, b) => a.order - b.order)
    .map((definition) => ({
      code: definition.code,
      amount: round0((amountOf(definition.code) / policy.daysInMonth) * employee.daysPayable),
    }));

  const earnedGross = earned.reduce((sum, c) => sum + c.amount, 0) + employee.arrears;

  // PF wages are earned gross less the components excluded from it — HRA, for
  // every organisation seen so far. Capped, never floored: somebody who worked
  // four days has PF wages of four days' pay.
  const excluded = new Set(components.filter((c) => !c.countsForPfWages).map((c) => c.code));
  const pfEligibleEarnings =
    earned.filter((c) => !excluded.has(c.code)).reduce((sum, c) => sum + c.amount, 0) +
    employee.arrears;
  const pfWages = Math.min(pfEligibleEarnings, policy.pfWageCeiling);

  const pfEmployee = round0(pfWages * policy.pfRate);
  const eps = round0(pfWages * policy.epsRate);

  // THE ASYMMETRY IS DELIBERATE. Eligibility is tested against FIXED gross —
  // what the person is contracted to earn — while the contribution is charged
  // on what they actually earned. Testing eligibility on earned gross instead
  // would drop a well-paid employee into ESI in any month they took unpaid
  // leave, and enrol them for a period they cannot leave.
  const esiEligible = fixedGross <= policy.esiGrossCeiling;
  const esiEmployee = esiEligible ? roundUp0(earnedGross * policy.esiEmployeeRate) : 0;
  const esiEmployer = esiEligible ? round0(earnedGross * policy.esiEmployerRate) : 0;

  const professionalTax = earnedGross > policy.ptThreshold ? policy.ptAmount : 0;

  const totalDeduction =
    pfEmployee +
    esiEmployee +
    professionalTax +
    employee.tds +
    employee.lwf +
    employee.otherDeduction;

  return {
    employeeCode: employee.employeeCode,
    departmentName: employee.departmentName,
    fixedGross,
    daysPayable: employee.daysPayable,
    earned,
    arrears: employee.arrears,
    earnedGross,
    pfWages,
    pfEmployee,
    eps,
    epsDifference: pfEmployee - eps,
    esiEligible,
    esiEmployee,
    esiEmployer,
    professionalTax,
    tds: employee.tds,
    lwf: employee.lwf,
    otherDeduction: employee.otherDeduction,
    totalDeduction,
    netPayable: earnedGross - totalDeduction,
    ncpDays: round0(policy.daysInMonth - employee.daysPayable),
  };
}

export function computePayRun(
  employees: readonly EmployeeInput[],
  components: readonly ComponentDefinition[],
  policy: PayrollPolicy,
): PayRunResult {
  const lines = employees.map((e) => computeEmployee(e, components, policy));

  return {
    lines,
    totals: sum(lines),
    byDepartment: byDepartment(lines),
  };
}

function sum(lines: readonly PayrollLine[]): PayrollTotals {
  return {
    employees: lines.length,
    fixedGross: lines.reduce((t, l) => t + l.fixedGross, 0),
    daysPayable: lines.reduce((t, l) => t + l.daysPayable, 0),
    earnedGross: lines.reduce((t, l) => t + l.earnedGross, 0),
    totalDeduction: lines.reduce((t, l) => t + l.totalDeduction, 0),
    netPayable: lines.reduce((t, l) => t + l.netPayable, 0),
  };
}

/**
 * Totals per department, ordered by name.
 *
 * A person with no department is its own group rather than being dropped —
 * `department_id` is nullable on `profiles`, and a workspace that has not
 * configured departments has everybody in that state. A summary whose rows do
 * not add up to the run is a summary nobody can reconcile.
 */
function byDepartment(lines: readonly PayrollLine[]): DepartmentTotals[] {
  const groups = new Map<string | null, PayrollLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.departmentName);
    if (existing) existing.push(line);
    else groups.set(line.departmentName, [line]);
  }

  return [...groups.entries()]
    .map(([departmentName, group]) => ({ departmentName, ...sum(group) }))
    .sort((a, b) => (a.departmentName ?? "￿").localeCompare(b.departmentName ?? "￿"));
}

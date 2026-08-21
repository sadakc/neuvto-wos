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
  EpfTreatment,
  PtSlab,
  EmployeeInput,
  PayRunResult,
  PayrollLine,
  PayrollPolicy,
  PayrollTotals,
  DepartmentTotals,
} from "./types";

/**
 * The statutory position as at FY 2026-27, Karnataka.
 *
 * Every organisation gets this until it says otherwise, and the schemes it
 * describes start ENABLED because the workbook this replaces runs all of them.
 * The labour welfare fund is the exception: it is off, because the workbook
 * hand-enters that figure and switching it on would restate a column somebody
 * has already reconciled.
 */
export const DEFAULT_POLICY: Omit<PayrollPolicy, "daysInMonth" | "periodMonth"> = {
  epfEnabled: true,
  pfWageCeiling: 15000,
  // The workbook's position, and the common one: PF is charged on wages
  // restricted to the ceiling.
  restrictPfWagesToCeiling: true,
  pfRate: 0.12,
  epsRate: 0.0833,
  edliRate: 0,
  pfAdminRate: 0,
  esiEnabled: true,
  esiGrossCeiling: 21000,
  esiEmployeeRate: 0.0075,
  esiEmployerRate: 0.0325,
  // Karnataka: nothing up to ₹24,999, ₹200 above it.
  ptSlabs: [
    { upTo: 24999, amount: 0 },
    { upTo: null, amount: 200 },
  ],
  lwf: { enabled: false, employee: 0, employer: 0, cycle: "yearly", deductInMonth: 12 },
};

/**
 * The band this earning falls in.
 *
 * First match on an ascending list, so the bands are read the way they are
 * written on the state's own form. No band at all means no tax — an
 * organisation in a state that levies none is not a zero-rate organisation, and
 * an empty list says that more clearly than a rate of nought.
 */
export function professionalTaxFor(earnedGross: number, slabs: readonly PtSlab[]): number {
  for (const slab of slabs) {
    if (slab.upTo === null || earnedGross <= slab.upTo) return slab.amount;
  }
  return 0;
}

/** Whether the labour welfare fund falls due in the month being paid. */
export function lwfDue(policy: PayrollPolicy): boolean {
  if (!policy.lwf.enabled) return false;
  return policy.lwf.cycle === "monthly" || policy.periodMonth === policy.lwf.deductInMonth;
}

export function computeEmployee(
  employee: EmployeeInput,
  components: readonly ComponentDefinition[],
  policy: PayrollPolicy,
): PayrollLine {
  const amountOf = (code: string) =>
    employee.fixedComponents.find((c) => c.code === code)?.amount ?? 0;

  const fixedGross = employee.fixedComponents.reduce((sum, c) => sum + c.amount, 0);

  const ordered = [...components].sort((a, b) => a.order - b.order);

  // Proration is by calendar day. A July salary and a February salary therefore
  // differ for identical attendance, which is what the workbook does and what
  // the customer's staff already expect to see. A component with `proRata` off
  // is paid whole — a joining bonus does not become 19/31 of itself.
  const prorate = (definition: ComponentDefinition) => {
    const monthly = amountOf(definition.code);
    return definition.proRata
      ? round0((monthly / policy.daysInMonth) * employee.daysPayable)
      : round0(monthly);
  };

  const earnings = ordered.filter((c) => c.category === "earning");
  const earned = earnings.map((definition) => ({
    code: definition.code,
    amount: prorate(definition),
  }));

  const earnedGross = earned.reduce((sum, c) => sum + c.amount, 0) + employee.arrears;

  /**
   * PF wages, in two passes because one of the three treatments depends on the
   * answer the other two produce.
   *
   * `always` components make up the base. If that base has NOT already reached
   * the ceiling, the `under_threshold` components are added to it — which is
   * what an employer means by "consider for EPF only when PF wage is below
   * ₹15,000": top the low earners up towards the statutory minimum, and leave
   * everybody above it alone.
   *
   * Capped, never floored. Somebody who worked four days has PF wages of four
   * days' pay.
   */
  const sumWhere = (treatment: EpfTreatment) =>
    earned
      .filter((c) => earnings.find((d) => d.code === c.code)?.epf === treatment)
      .reduce((sum, c) => sum + c.amount, 0);

  const alwaysWages = sumWhere("always") + employee.arrears;
  const pfEligibleEarnings =
    alwaysWages < policy.pfWageCeiling ? alwaysWages + sumWhere("under_threshold") : alwaysWages;
  const pfWages = policy.restrictPfWagesToCeiling
    ? Math.min(pfEligibleEarnings, policy.pfWageCeiling)
    : pfEligibleEarnings;

  // Standing deductions carried by the salary structure, itemised and kept
  // apart from `otherDeduction` — that is a figure typed into one run, and a
  // payslip merging a standing deduction with a one-off correction cannot
  // explain either of them.
  const deductions = ordered
    .filter((c) => c.category === "deduction")
    .map((definition) => ({ code: definition.code, amount: prorate(definition) }))
    .filter((d) => d.amount !== 0);
  const componentDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

  // Off means no scheme, not a scheme that deducted nothing. An establishment
  // under twenty people is not required to register, and a payslip showing ₹0
  // provident fund implies one that is.
  const pfEmployee = policy.epfEnabled ? round0(pfWages * policy.pfRate) : 0;
  const eps = policy.epfEnabled ? round0(pfWages * policy.epsRate) : 0;
  const edli = policy.epfEnabled ? round0(pfWages * policy.edliRate) : 0;
  const pfAdmin = policy.epfEnabled ? round0(pfWages * policy.pfAdminRate) : 0;

  // THE ASYMMETRY IS DELIBERATE. Eligibility is tested against FIXED gross —
  // what the person is contracted to earn — while the contribution is charged
  // on what they actually earned. Testing eligibility on earned gross instead
  // would drop a well-paid employee into ESI in any month they took unpaid
  // leave, and enrol them for a period they cannot leave.
  const esiEligible = policy.esiEnabled && fixedGross <= policy.esiGrossCeiling;
  const esiEmployee = esiEligible ? roundUp0(earnedGross * policy.esiEmployeeRate) : 0;
  const esiEmployer = esiEligible ? round0(earnedGross * policy.esiEmployerRate) : 0;

  const professionalTax = professionalTaxFor(earnedGross, policy.ptSlabs);

  // A configured scheme GOVERNS. When labour welfare fund is switched on, the
  // figure is the scheme's — including the zero it produces in the eleven
  // months of the year it is not collected — and the number typed into the run
  // is ignored. Leaving the typed value in place for those months is how a
  // yearly fund gets collected twelve times.
  const lwf = policy.lwf.enabled ? (lwfDue(policy) ? policy.lwf.employee : 0) : employee.lwf;

  const totalDeduction =
    pfEmployee +
    esiEmployee +
    professionalTax +
    employee.tds +
    lwf +
    componentDeductions +
    employee.otherDeduction;

  return {
    employeeCode: employee.employeeCode,
    departmentName: employee.departmentName,
    fixedGross,
    daysPayable: employee.daysPayable,
    earned,
    deductions,
    componentDeductions,
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
    edli,
    pfAdmin,
    tds: employee.tds,
    lwf,
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

/**
 * What the payroll engine consumes and produces.
 *
 * Plain interfaces, no Zod. Validation belongs to the module that calls this —
 * `src/modules/payroll/contracts.ts` — because the schemas there mirror
 * database constraints, and this package must not know that a database exists.
 */

/**
 * A salary component as the organisation defines it.
 *
 * `countsForPfWages` is the only flag the arithmetic reads, and it exists
 * because the source workbook computes PF wages as `earnedGross − earnedHRA`.
 * Stated as "which components make up PF wages" rather than "subtract HRA", the
 * rule survives an organisation that calls the component something else, or has
 * two of them.
 */
export interface ComponentDefinition {
  readonly code: string;
  readonly name: string;
  readonly countsForPfWages: boolean;
  /** Display order on the payslip and the register. */
  readonly order: number;
}

/** What this person is paid per month, before any proration. */
export interface FixedComponentAmount {
  readonly code: string;
  readonly amount: number;
}

export interface EmployeeInput {
  readonly employeeCode: string;
  readonly departmentName: string | null;
  /**
   * The monthly amounts, held per employee rather than derived from gross.
   *
   * DERIVING THESE WOULD BE WRONG. The source workbook appears to compute
   * `basic = 50% of gross` and `hra = 40% of basic`, and those rules are stated
   * in its formula bar — but they hold for only 12 and 20 of its 44 employees
   * respectively. Everyone else has hand-entered amounts, and for all 44 the
   * components sum exactly to gross.
   *
   * So the percentages are a template for setting somebody up, not a rule for
   * paying them. An engine that recomputed them would quietly restate the pay
   * of three quarters of the workforce.
   */
  readonly fixedComponents: readonly FixedComponentAmount[];
  /** Whole days or halves — the muster roll produces figures like 26.5. */
  readonly daysPayable: number;
  readonly arrears: number;
  /** Entered by hand, exactly as the workbook does. Never derived here. */
  readonly tds: number;
  readonly lwf: number;
  readonly otherDeduction: number;
}

/**
 * The statutory and calendar constants for one pay period.
 *
 * Every rate is passed in rather than baked in. A rate written into the engine
 * is a rate that changes with a deployment, and these change by notification.
 */
export interface PayrollPolicy {
  /** Calendar days in the month. Proration is by calendar day, not a fixed 30. */
  readonly daysInMonth: number;
  readonly pfWageCeiling: number;
  readonly pfRate: number;
  readonly epsRate: number;
  /** Tested against FIXED gross, not earned — see `computeEmployee`. */
  readonly esiGrossCeiling: number;
  readonly esiEmployeeRate: number;
  readonly esiEmployerRate: number;
  /** Professional tax applies above this earned gross, at `ptAmount`. */
  readonly ptThreshold: number;
  readonly ptAmount: number;
}

export interface EarnedComponent {
  readonly code: string;
  readonly amount: number;
}

export interface PayrollLine {
  readonly employeeCode: string;
  readonly departmentName: string | null;
  readonly fixedGross: number;
  readonly daysPayable: number;
  readonly earned: readonly EarnedComponent[];
  readonly arrears: number;
  readonly earnedGross: number;

  readonly pfWages: number;
  readonly pfEmployee: number;
  readonly eps: number;
  /** EPF minus EPS — the 3.67% the ECR return reports separately. */
  readonly epsDifference: number;

  /**
   * False means this person is outside ESI, and their contribution is not
   * merely zero. The workbook renders both as `0` and cannot tell them apart,
   * which hides whether the eligibility test ran at all.
   */
  readonly esiEligible: boolean;
  readonly esiEmployee: number;
  readonly esiEmployer: number;

  readonly professionalTax: number;
  readonly tds: number;
  readonly lwf: number;
  readonly otherDeduction: number;
  readonly totalDeduction: number;
  readonly netPayable: number;

  /** Non-contributory period days, for the PF return. */
  readonly ncpDays: number;
}

export interface PayrollTotals {
  readonly employees: number;
  readonly fixedGross: number;
  readonly daysPayable: number;
  readonly earnedGross: number;
  readonly totalDeduction: number;
  readonly netPayable: number;
}

export interface DepartmentTotals extends PayrollTotals {
  readonly departmentName: string | null;
}

export interface PayRunResult {
  readonly lines: readonly PayrollLine[];
  readonly totals: PayrollTotals;
  readonly byDepartment: readonly DepartmentTotals[];
}

/**
 * What the payroll engine consumes and produces.
 *
 * Plain interfaces, no Zod. Validation belongs to the module that calls this —
 * `src/modules/payroll/contracts.ts` — because the schemas there mirror
 * database constraints, and this package must not know that a database exists.
 */

/** What kind of thing a component is. Only earnings and deductions reach a run. */
export type ComponentCategory = "earning" | "deduction" | "benefit" | "reimbursement";

/**
 * How a component contributes to provident fund wages.
 *
 * `off` is the workbook's house rent allowance — PF wages are earned gross less
 * HRA, stated as "which components make up PF wages" rather than "subtract
 * HRA", so the rule survives an employer who calls it something else or has two
 * of them.
 *
 * `under_threshold` is the awkward one, and it is real: employers add
 * allowances to PF wages for people earning under the ceiling, so their
 * contribution reaches the statutory minimum, and leave them out for everybody
 * above it. Read as "include this only if the components that always count have
 * not already reached the ceiling".
 */
export type EpfTreatment = "off" | "always" | "under_threshold";

/**
 * A salary component as the organisation defines it.
 *
 * Four categories exist in configuration; two of them reach the arithmetic.
 * An `earning` becomes a line of pay, prorated unless `proRata` says otherwise;
 * a `deduction` is a fixed monthly amount taken off. `benefit` and
 * `reimbursement` are configured and deliberately compute nothing yet — they
 * need a claims flow, and a component that looks configured while changing no
 * payslip is worse than one that was never offered.
 */
export interface ComponentDefinition {
  readonly code: string;
  readonly name: string;
  readonly category: ComponentCategory;
  readonly epf: EpfTreatment;
  /**
   * Off means the full monthly amount is paid however many days were worked —
   * a joining bonus does not become 19/31 of itself.
   */
  readonly proRata: boolean;
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
/**
 * One band of professional tax. `upTo` is inclusive; `null` is "and above".
 *
 * A list rather than a threshold and an amount, because professional tax is a
 * STATE tax and the states do not agree on how many bands there are. Karnataka
 * has two; Maharashtra has three and a different one in March. Encoding
 * Karnataka's shape as the shape would mean rewriting the engine to sell to
 * somebody in Pune.
 */
export interface PtSlab {
  readonly upTo: number | null;
  readonly amount: number;
}

/** Labour welfare fund: a flat contribution, usually once a year. */
export interface LwfScheme {
  readonly enabled: boolean;
  readonly employee: number;
  readonly employer: number;
  readonly cycle: "monthly" | "yearly";
  /** 1–12. Only read when `cycle` is `yearly`. Karnataka collects in December. */
  readonly deductInMonth: number;
}

export interface PayrollPolicy {
  /** Calendar days in the month. Proration is by calendar day, not a fixed 30. */
  readonly daysInMonth: number;
  /**
   * 1–12, the month being paid. Read only by the labour welfare fund, which is
   * collected once a year and therefore has to know which month it is.
   */
  readonly periodMonth: number;
  /**
   * Whether this organisation runs EPF at all. Off means no provident fund line
   * rather than a zero one — an establishment under twenty people is not
   * required to register, and a payslip claiming ₹0 PF implies a scheme that
   * happens to have deducted nothing.
   */
  readonly epfEnabled: boolean;
  readonly pfWageCeiling: number;
  /**
   * Whether PF wages are capped at the ceiling ("restricted PF wage") or
   * charged on what the person actually earned ("actual PF wage"). Employers
   * choose, and the EPF configuration screen asks.
   *
   * THIS IS WHAT MAKES `under_threshold` MEAN ANYTHING. While wages are capped,
   * `min(base, cap)` and `min(base + extra, cap)` agree whether the base is
   * above the ceiling or below it — so the treatment computes identically to
   * `always` and the distinction is invisible. Uncapped, it is the difference
   * between charging PF on 20,000 and on 25,000.
   */
  readonly restrictPfWagesToCeiling: boolean;
  readonly pfRate: number;
  readonly epsRate: number;
  /** Employer-side, on PF wages. Both zero unless the organisation includes them. */
  readonly edliRate: number;
  readonly pfAdminRate: number;
  readonly esiEnabled: boolean;
  /** Tested against FIXED gross, not earned — see `computeEmployee`. */
  readonly esiGrossCeiling: number;
  readonly esiEmployeeRate: number;
  readonly esiEmployerRate: number;
  /** Bands, lowest first. An empty list means this state levies none. */
  readonly ptSlabs: readonly PtSlab[];
  readonly lwf: LwfScheme;
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

  /**
   * Recurring deductions this person's salary structure carries, itemised.
   * Separate from `otherDeduction`, which is a figure typed into one run — a
   * standing deduction and a one-off correction are different things and a
   * payslip that merges them cannot explain either.
   */
  readonly deductions: readonly EarnedComponent[];
  readonly componentDeductions: number;

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
  /**
   * Employer-side contributions the PF return asks for separately. Zero unless
   * the organisation has chosen to include them; never deducted from anybody.
   */
  readonly edli: number;
  readonly pfAdmin: number;
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

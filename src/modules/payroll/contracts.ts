/**
 * Payroll contracts.
 *
 * Zod schemas are the source of truth; types derive from them so the two cannot
 * drift (CODING_STANDARDS §3). Every rule here mirrors a CHECK constraint in
 * the payroll migration exactly — a form that accepts what the database refuses
 * produces an unexplained failure, which is worse than a validation message.
 */

import { z } from "zod";

export const PAY_RUN_STATUSES = ["draft", "pending_approval", "approved", "paid"] as const;
export type PayRunStatus = (typeof PAY_RUN_STATUSES)[number];

/** salary_component_code_shape. The code reaches a CSV column header. */
export const ComponentInput = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(1, "Give this component a code")
    .max(40, "That code is too long")
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Use lower-case letters, numbers and underscores — basic, hra, special_allowance",
    ),
  name: z.string().trim().min(1, "Give this component a name").max(60, "That name is too long"),
  /**
   * The only flag the arithmetic reads. False for HRA in every organisation
   * seen so far, because PF wages are earned gross less HRA.
   */
  countsForPfWages: z.boolean(),
  displayOrder: z.number().int().min(0).max(999),
});
export type ComponentInput = z.infer<typeof ComponentInput>;

/**
 * Statutory identifiers, each shaped as the portal that consumes it demands.
 *
 * ALL OPTIONAL, AND THAT IS NOT LAXITY. Payroll is configured over weeks, and a
 * person whose UAN has not arrived yet is ordinary. What is not ordinary is an
 * eleven-digit UAN, which the EPFO portal rejects in bulk hours after the
 * deadline with no indication of which row.
 *
 * `.or(z.literal(""))` on each: an untouched form field arrives as an empty
 * string, and refusing that would make every half-filled form unsaveable.
 */
const optionalPattern = (re: RegExp, message: string) =>
  z.string().trim().regex(re, message).or(z.literal("")).optional();

export const EmployeePayrollInput = z.object({
  employeeId: z.string().uuid(),
  uan: optionalPattern(/^[0-9]{12}$/, "A UAN is exactly 12 digits"),
  esiNumber: optionalPattern(/^[0-9]{10,17}$/, "An ESI number is 10 to 17 digits"),
  pan: optionalPattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "A PAN looks like ABCDE1234F"),
  bankName: z.string().trim().max(80, "That bank name is too long").optional(),
  bankAccountNumber: optionalPattern(/^[0-9]{5,20}$/, "An account number is 5 to 20 digits"),
  bankIfsc: optionalPattern(/^[A-Z]{4}0[A-Z0-9]{6}$/, "An IFSC looks like CNRB0001234"),
});
export type EmployeePayrollInput = z.infer<typeof EmployeePayrollInput>;

export const StructureInput = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .refine((d) => !Number.isNaN(Date.parse(d)), "Choose a real date"),
  amounts: z
    .array(
      z.object({
        componentId: z.string().uuid(),
        // salary_structure_line_amount_sane: >= 0. Zero is legitimate — a
        // component this person does not receive.
        amount: z
          .number({ invalid_type_error: "Enter an amount" })
          .min(0, "An amount cannot be negative")
          .max(99_999_999, "That amount is too large"),
      }),
    )
    .min(1, "A salary structure needs at least one component"),
});
export type StructureInput = z.infer<typeof StructureInput>;

/**
 * What an administrator enters for each person before a run is computed.
 *
 * Days payable, not an attendance grid. The muster roll that produces this
 * number is a later module; until then it is typed in or imported, and it
 * arrives in halves because a half day worked is half a day paid.
 */
export const DaysInput = z.object({
  employeeId: z.string().uuid(),
  daysPayable: z
    .number({ invalid_type_error: "Enter a number of days" })
    .min(0, "Days cannot be negative")
    .max(31, "A month has at most 31 days")
    .multipleOf(0.5, "Use whole days or halves — 26 or 26.5, not 26.4"),
  arrears: z.number().min(0, "Arrears cannot be negative").default(0),
  tds: z.number().min(0, "TDS cannot be negative").default(0),
  lwf: z.number().min(0, "Labour welfare fund cannot be negative").default(0),
  otherDeduction: z.number().min(0, "A deduction cannot be negative").default(0),
});
export type DaysInput = z.infer<typeof DaysInput>;

/**
 * When people are paid, and how a month's worth of days is counted.
 *
 * Mirrors `PaySchedule` in `src/payroll-core/schedule.ts`, which is where the
 * arithmetic lives — the engine has no Zod and this file has no dates.
 *
 * The WORKING WEEK is deliberately absent. The source spec puts it here, and it
 * already exists once, in the platform's working calendar, where Leave counts
 * against it and Attendance will too. A second copy owned by payroll is a
 * workspace with two weekends, and the one that pays people would eventually
 * disagree with the one that counts their days off.
 */
export const PayScheduleInput = z.object({
  calculationMethod: z.enum(["actual_days", "fixed_days"]).default("actual_days"),
  fixedDays: z
    .number()
    .int()
    .min(28, "A month is at least 28 days")
    .max(31, "A month is at most 31 days")
    .default(30),
  payDateRule: z.enum(["last_working_day", "day_of_next_month"]).default("last_working_day"),
  payDay: z
    .number()
    .int()
    .min(1, "Choose a day of the month")
    .max(31, "A month has at most 31 days")
    .default(1),
});
export type PayScheduleInput = z.infer<typeof PayScheduleInput>;

/**
 * What an employee is shown of their own pay.
 *
 * Two of these are NOT the same kind of switch, and the difference is the whole
 * reason this comment exists.
 *
 * `payslipsVisible` is a permission. Turning it off has to stop the data
 * reaching the person, not stop the screen drawing it — so `pay_run_lines`
 * reads this setting itself and refuses a non-administrator when it is off. A
 * toggle that only hides a link is not a permission.
 *
 * `showStatutoryBreakdown` is presentation, and honestly so. The figures it
 * hides are the employee's own PF and ESI on their own payslip; concealing them
 * from the person they belong to is a matter of how much detail a workspace
 * wants on screen, not of who may see what. It is enforced nowhere but the
 * component, and that is correct.
 */
export const EmployeePortalInput = z.object({
  payslipsVisible: z.boolean().default(true),
  showStatutoryBreakdown: z.boolean().default(true),
  showPayDate: z.boolean().default(true),
});
export type EmployeePortalInput = z.infer<typeof EmployeePortalInput>;

/**
 * Everything this module lets a customer configure, stored as one row in
 * `module_settings` (D7).
 *
 * Every field carries a default, all the way down, so that `parse({})` answers
 * fully. A workspace that has never opened this screen still has to be paid,
 * and "unconfigured" must never be a state a payslip can meet.
 */
export const PayrollSettings = z.object({
  paySchedule: PayScheduleInput.default({}),
  employeePortal: EmployeePortalInput.default({}),
});
export type PayrollSettings = z.infer<typeof PayrollSettings>;

/**
 * Every refusal the database raises, in words an administrator can act on.
 *
 * The bare code survives in `details` so a support conversation can still reach
 * the real cause.
 */
const MESSAGES: Record<string, string> = {
  FORBIDDEN: "Only an administrator can run payroll.",
  NOT_FOUND: "That pay run no longer exists.",
  MODULE_DISABLED: "Payroll is switched off for this workspace.",
  PAY_RUN_NOT_DRAFT:
    "This pay run has already been submitted, so it cannot be changed. Withdraw the approval first.",
  PAY_RUN_LOCKED: "This pay run has been approved and can no longer be changed.",
  PAY_RUN_EMPTY: "There is nobody to pay in this run yet. Set up salary structures first.",
  CROSS_TENANT_EMPLOYEE: "That employee is not in this workspace.",
  INVALID_LINES: "The computed pay run could not be read. Try computing it again.",
  NO_APPROVER: "Nobody is set up to approve a pay run. Configure an approval chain first.",
};

export function payrollErrorMessage(code: string): string {
  if (MESSAGES[code]) return MESSAGES[code];

  // DUPLICATE_EMPLOYEE_CODE carries the code that clashed. The number is the
  // point — an admin told only "duplicate" has to hunt for which one.
  const duplicate = /^DUPLICATE_EMPLOYEE_CODE:\s*(.+)$/.exec(code);
  if (duplicate) return `Somebody in this workspace already has employee code ${duplicate[1]}.`;

  return "That didn't work. Please try again.";
}

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  countsForPfWages: boolean;
  displayOrder: number;
  status: "active" | "archived";
}

/** One person on the statutory-details screen. Nulls are ordinary, not errors. */
export interface EmployeePayrollRow {
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  uan: string | null;
  esiNumber: string | null;
  pan: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
}

/**
 * One person on the salary-structure screen.
 *
 * `effectiveFrom: null` means they have no structure in force and cannot be
 * paid. `fixedGross` is the sum of `amounts` — derived on read, never stored,
 * so it cannot disagree with the parts it is made of.
 */
export interface StructureRow {
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  effectiveFrom: string | null;
  amounts: { componentId: string; amount: number }[];
  fixedGross: number;
}

export interface PayRunSummary {
  id: string;
  periodMonth: string;
  daysInMonth: number;
  status: PayRunStatus;
  computedAt: string | null;
  lockedAt: string | null;
  employees: number;
  earnedGross: number;
  totalDeduction: number;
  netPayable: number;
}

export interface PayslipLine {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  departmentName: string | null;
  earned: { code: string; amount: number }[];
  fixedGross: number;
  daysPayable: number;
  arrears: number;
  earnedGross: number;
  pfWages: number;
  pfEmployee: number;
  eps: number;
  epsDifference: number;
  esiEligible: boolean;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  tds: number;
  lwf: number;
  otherDeduction: number;
  totalDeduction: number;
  netPayable: number;
  ncpDays: number;
}

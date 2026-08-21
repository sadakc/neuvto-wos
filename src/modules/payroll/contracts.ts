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

export const COMPONENT_CATEGORIES = ["earning", "deduction", "benefit", "reimbursement"] as const;
export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

export const EPF_TREATMENTS = ["off", "always", "under_threshold"] as const;
export type EpfTreatment = (typeof EPF_TREATMENTS)[number];

export const CALCULATION_TYPES = ["flat_amount", "percent_of_ctc", "percent_of_basic"] as const;
export type CalculationType = (typeof CALCULATION_TYPES)[number];

export const DEDUCTION_FREQUENCIES = ["one_time", "recurring"] as const;
export const UNCLAIMED_POLICIES = ["carry_forward", "encash_monthly"] as const;

/**
 * A salary component, in any of its four categories.
 *
 * One schema rather than four, because the list and the edit form are one shell
 * with a different field set per category — which is the source spec's own
 * observation, and the reason it says build the shell once. The rules that
 * genuinely differ are in `superRefine` below, where they can say WHY.
 *
 * `salary_component_code_shape` — the code reaches a payslip and a CSV column
 * header, so spaces and punctuation in it become a file the EPFO portal or a
 * bank rejects.
 */
export const ComponentInput = z
  .object({
    id: z.string().uuid().optional(),
    category: z.enum(COMPONENT_CATEGORIES).default("earning"),
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
    /** What the employee sees. Falls back to `name` when left blank. */
    nameInPayslip: z.string().trim().max(60, "That name is too long").default(""),
    calculationType: z.enum(CALCULATION_TYPES).default("flat_amount"),
    /** A template for setting the NEXT person up. The amount that gets paid lives on the person. */
    defaultAmount: z
      .number()
      .min(0, "An amount cannot be negative")
      .max(99_999_999, "That amount is too large")
      .nullable()
      .default(null),
    defaultPercentage: z
      .number()
      .min(0, "A percentage cannot be negative")
      .max(100, "A percentage cannot be over 100")
      .nullable()
      .default(null),
    /**
     * How this component contributes to provident fund wages. `under_threshold`
     * is only observable once EPF is set to charge on actual rather than
     * restricted wages — see the EPF scheme.
     */
    epf: z.enum(EPF_TREATMENTS).default("always"),
    esi: z.boolean().default(true),
    isTaxable: z.boolean().default(true),
    isProRata: z.boolean().default(true),
    isFbp: z.boolean().default(false),
    showOnPayslip: z.boolean().default(true),
    partOfStructure: z.boolean().default(true),
    frequency: z.enum(DEDUCTION_FREQUENCIES).nullable().default(null),
    maxAmountPerMonth: z
      .number()
      .min(0, "A limit cannot be negative")
      .max(99_999_999, "That limit is too large")
      .nullable()
      .default(null),
    unclaimedPolicy: z.enum(UNCLAIMED_POLICIES).nullable().default(null),
    displayOrder: z.number().int().min(0).max(999),
  })
  .superRefine((v, ctx) => {
    // Mirrors salary_component_percentage_is_an_earning. "40% of basic" is not
    // something anybody means by a canteen recovery, and offering it would put
    // a number on screen that nothing computes.
    if (v.calculationType !== "flat_amount" && v.category !== "earning") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calculationType"],
        message: "Only an earning can be a percentage. Give this one an amount.",
      });
    }

    if (v.calculationType !== "flat_amount" && v.defaultPercentage === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultPercentage"],
        message: "Enter a percentage",
      });
    }

    // A deduction with no frequency is a deduction nobody can tell you will
    // happen again next month, which is the only thing an employee wants to
    // know about it.
    if (v.category === "deduction" && v.frequency === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frequency"],
        message: "Say whether this happens once or every month",
      });
    }

    if (v.category === "reimbursement" && v.unclaimedPolicy === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unclaimedPolicy"],
        message: "Say what happens to an unclaimed balance",
      });
    }
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

/**
 * A named salary shape, applied when somebody is being set up.
 *
 * Copied on application and then forgotten — see the migration. A template that
 * stayed attached would restate the pay of everybody on it the moment somebody
 * edited it, from a screen that looks like configuration.
 */
export const TemplateInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give this template a name").max(60, "That name is too long"),
  description: z.string().trim().max(200, "That description is too long").default(""),
  amounts: z
    .array(
      z.object({
        componentId: z.string().uuid(),
        amount: z
          .number({ invalid_type_error: "Enter an amount" })
          .min(0, "An amount cannot be negative")
          .max(99_999_999, "That amount is too large"),
      }),
    )
    .min(1, "A template needs at least one component"),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

export interface SalaryTemplate {
  id: string;
  name: string;
  description: string;
  amounts: { componentId: string; amount: number }[];
  /** Sum of the earning amounts. Derived, like every other gross in this module. */
  gross: number;
}

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
  /**
   * The denominator, when proration does not follow the calendar.
   *
   * 1 to 31, NOT 28 to 31. It was the latter, on the reasoning that a month has
   * at least 28 days — but this is not a count of days in a month, it is the
   * figure a monthly salary is divided by, and dividing by 26 working days is
   * standard practice on a six-day week. The narrower rule refused a real
   * arrangement.
   */
  fixedDays: z
    .number()
    .int()
    .min(1, "A month must be divided by at least one day")
    .max(31, "A month has at most 31 days")
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
  /** An announcement on the payslip screen. Empty means none. */
  bannerMessage: z.string().trim().max(280, "Keep it under 280 characters").default(""),
  /**
   * The day the banner stops showing, `YYYY-MM-DD`. Empty means it stays until
   * somebody takes it down — which is how a "salary delayed this month" notice
   * ends up on screen in March.
   */
  bannerUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .or(z.literal(""))
    .default(""),
  /** Who to ask about a payslip. A name and an address, shown together. */
  contactName: z.string().trim().max(80).default(""),
  contactEmail: z
    .string()
    .trim()
    .email("That doesn't look like an email address")
    .or(z.literal(""))
    .default(""),
});
export type EmployeePortalInput = z.infer<typeof EmployeePortalInput>;

/**
 * The statutory schemes, each switched on or off deliberately.
 *
 * ── A deliberate divergence from the source spec ────────────────────────────
 *
 * The spec ships every scheme OFF behind an explainer and an "Enable" button,
 * and that is right for a product onboarding a customer who may not be
 * registered. It is wrong here, for one reason: **provident fund, employee
 * state insurance and professional tax already run.** They have been computed
 * on every pay run this module has ever produced, and a default of off would
 * mean this release quietly stripping all three from the next payslip of every
 * existing workspace — the same rule that governed the component backfill, a
 * release must not restate a payslip.
 *
 * So the three that already run default ON at their statutory rates, and the
 * two the workbook does not do — labour welfare fund and statutory bonus —
 * default OFF. Every one of them is a visible switch with an explainer either
 * way, so switching provident fund off for an establishment under twenty people
 * is one deliberate click rather than an argument with the product.
 *
 * Rates carry their statutory defaults, so an organisation switching a scheme
 * on gets the correct arithmetic without having to know it.
 */
export const EpfScheme = z.object({
  enabled: z.boolean().default(true),
  /**
   * Restricted charges PF on wages capped at the ceiling; actual charges on
   * what was earned. This is also the switch that makes a component's
   * `under_threshold` treatment mean anything — capped, it is invisible.
   */
  restrictToCeiling: z.boolean().default(true),
  wageCeiling: z.number().min(0).max(1_000_000).default(15_000),
  employeeRate: z.number().min(0).max(100).default(12),
  pensionRate: z.number().min(0).max(100).default(8.33),
  /** Employer-side, and only charged when the organisation includes them. */
  includeEdli: z.boolean().default(false),
  edliRate: z.number().min(0).max(100).default(0.5),
  includeAdminCharges: z.boolean().default(false),
  adminChargeRate: z.number().min(0).max(100).default(0.5),
});
export type EpfScheme = z.infer<typeof EpfScheme>;

export const EsiScheme = z.object({
  enabled: z.boolean().default(true),
  /** `00-00-000000-000-0000`. Optional, like every other identifier here. */
  number: z
    .string()
    .trim()
    .regex(
      /^[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9]{3}-[0-9]{4}$/,
      "An ESI number looks like 00-00-000000-000-0000",
    )
    .or(z.literal(""))
    .default(""),
  grossCeiling: z.number().min(0).max(1_000_000).default(21_000),
  employeeRate: z.number().min(0).max(100).default(0.75),
  employerRate: z.number().min(0).max(100).default(3.25),
  includeEmployerInCtc: z.boolean().default(false),
});
export type EsiScheme = z.infer<typeof EsiScheme>;

/**
 * Professional tax, as bands rather than a threshold and an amount.
 *
 * It is a STATE tax and the states do not agree on how many bands there are.
 * Karnataka has two; encoding that shape as the shape would mean rewriting the
 * engine to sell to somebody in Pune. `upTo: null` is the top band.
 *
 * The workbook this replaces files *Form 5A under the Andhra Pradesh*
 * Professions Tax Act while the establishment is in Karnataka and the slab it
 * actually applies is Karnataka's. Naming the state here is how that stops
 * being a thing nobody notices.
 */
export const PtSlabInput = z.object({
  upTo: z.number().min(0).max(100_000_000).nullable(),
  amount: z.number().min(0).max(100_000),
});

export const PtScheme = z.object({
  enabled: z.boolean().default(true),
  state: z.string().trim().max(60).default("Karnataka"),
  registrationNumber: z.string().trim().max(40).default(""),
  slabs: z.array(PtSlabInput).default([
    { upTo: 24_999, amount: 0 },
    { upTo: null, amount: 200 },
  ]),
});
export type PtScheme = z.infer<typeof PtScheme>;

export const LwfScheme = z.object({
  enabled: z.boolean().default(false),
  state: z.string().trim().max(60).default("Karnataka"),
  employee: z.number().min(0).max(100_000).default(50),
  employer: z.number().min(0).max(100_000).default(100),
  cycle: z.enum(["monthly", "yearly"]).default("yearly"),
  /** Karnataka collects in December. */
  deductInMonth: z.number().int().min(1).max(12).default(12),
});
export type LwfScheme = z.infer<typeof LwfScheme>;

/**
 * Statutory bonus — CONFIGURED, and deliberately not computed.
 *
 * Bonus and off-cycle runs are out of scope for this MVP, and the arithmetic
 * needs a per-state minimum wage table this product does not have. Recording
 * the percentage an organisation has settled on is still worth doing; pretending
 * it reaches a payslip would not be.
 *
 * The statutory range is 8.33% to 20% and the schema holds employers to it,
 * because a number outside it is not a policy decision, it is a typo.
 */
export const BonusScheme = z.object({
  enabled: z.boolean().default(false),
  frequency: z.enum(["monthly", "yearly"]).default("yearly"),
  percentage: z
    .number()
    .min(8.33, "Statutory bonus is at least 8.33%")
    .max(20, "Statutory bonus is capped at 20%")
    .default(8.33),
});
export type BonusScheme = z.infer<typeof BonusScheme>;

export const StatutorySchemes = z.object({
  epf: EpfScheme.default({}),
  esi: EsiScheme.default({}),
  pt: PtScheme.default({}),
  lwf: LwfScheme.default({}),
  bonus: BonusScheme.default({}),
});
export type StatutorySchemes = z.infer<typeof StatutorySchemes>;

/**
 * The organisation's own tax identifiers.
 *
 * None of these changes a payslip by a rupee, and all of them decide whether a
 * TDS return can be filed at all — the same argument as an employee's UAN, one
 * level up. Every field optional and every field shaped, because a malformed
 * PAN is rejected by the portal hours later without saying which one.
 */
const optionalShape = (re: RegExp, message: string) =>
  z.string().trim().toUpperCase().regex(re, message).or(z.literal("")).default("");

export const TaxDetails = z.object({
  pan: optionalShape(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "A PAN looks like AAAAA0000A"),
  tan: optionalShape(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "A TAN looks like AAAA00000A"),
  /** Four segments: area code / AO type / range code / AO number. */
  tdsCircle: z.string().trim().max(40, "That is too long").default(""),
  paymentFrequency: z.enum(["monthly", "quarterly"]).default("monthly"),
  deductorType: z.enum(["employee", "non_employee"]).default("employee"),
  deductorName: z.string().trim().max(80, "That name is too long").default(""),
  deductorFatherName: z.string().trim().max(80, "That name is too long").default(""),
});
export type TaxDetails = z.infer<typeof TaxDetails>;

export const PAYSLIP_LAYOUTS = ["standard", "detailed", "compact"] as const;
export type PayslipLayout = (typeof PAYSLIP_LAYOUTS)[number];

/**
 * How a payslip is laid out, and what a workspace announces on it.
 *
 * Layouts rather than "PDF templates": the payslip goes to paper through the
 * browser's own print dialog, so a variant is a print layout and not a document
 * format. Three, doing genuinely different things — not six that differ by
 * margin.
 */
export const PayslipTemplate = z.object({
  layout: z.enum(PAYSLIP_LAYOUTS).default("standard"),
  /** Shown under the company name. A registered address, usually. */
  letterhead: z.string().trim().max(200, "That is too long").default(""),
  showYearToDate: z.boolean().default(false),
  footerNote: z
    .string()
    .trim()
    .max(200, "That is too long")
    .default("This is a system-generated document."),
});
export type PayslipTemplate = z.infer<typeof PayslipTemplate>;

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
  statutory: StatutorySchemes.default({}),
  taxDetails: TaxDetails.default({}),
  payslip: PayslipTemplate.default({}),
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
  TEMPLATE_NAME_TAKEN: "A salary template with that name already exists.",
  COMPONENT_IN_USE:
    "Somebody's salary already uses this component, so only its name and default amount can change. Add a new component instead.",
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
  category: ComponentCategory;
  code: string;
  name: string;
  nameInPayslip: string;
  calculationType: CalculationType;
  defaultAmount: number | null;
  defaultPercentage: number | null;
  epf: EpfTreatment;
  esi: boolean;
  isTaxable: boolean;
  isProRata: boolean;
  isFbp: boolean;
  showOnPayslip: boolean;
  partOfStructure: boolean;
  frequency: "one_time" | "recurring" | null;
  maxAmountPerMonth: number | null;
  unclaimedPolicy: "carry_forward" | "encash_monthly" | null;
  displayOrder: number;
  status: "active" | "archived";
  /**
   * True once at least one person's salary structure names this component.
   *
   * Derived on read, never stored — a stored flag and the structures it
   * describes drift, and it is the flag that lies. What it gates is the source
   * spec's rule repeated on every category: after somebody is on it, only the
   * name and the default amount stay editable, because flipping a component out
   * of PF wages in November would silently restate every payslip computed
   * against it since April.
   */
  inUse: boolean;
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
  /** Standing deductions from the salary structure, frozen with the rest. */
  deductions: { code: string; amount: number }[];
  componentDeductions: number;
  fixedGross: number;
  daysPayable: number;
  arrears: number;
  earnedGross: number;
  pfWages: number;
  pfEmployee: number;
  eps: number;
  epsDifference: number;
  /** Employer-side, for the ECR return. Never deducted from anybody. */
  edli: number;
  pfAdmin: number;
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

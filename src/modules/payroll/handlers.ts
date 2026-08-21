/**
 * Payroll handlers.
 *
 * Thin wrappers over the database functions — with one deliberate exception.
 *
 * LEAVE PUTS ITS RULES IN SQL; PAYROLL DOES NOT. The arithmetic lives in
 * `src/payroll-core`, a pure package with no database, whose acceptance test is
 * a real month of the workbook this module replaces. `computeRun` below is the
 * only place the two meet: it reads the inputs through one RPC, runs the
 * engine, and writes the result back through another.
 *
 * What the database still owns is every refusal — who may run a payroll, whose
 * they may run, and that an approved one never changes — plus CHECK constraints
 * that reject a line whose own numbers disagree. So the engine moving out cost
 * no guarantee; it moved the arithmetic somewhere it can be proved in
 * milliseconds against 44 real employees.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError } from "@/platform/errors";
import { getModuleSettings, saveModuleSettings } from "@/platform/modules";
import { getExcludedDays } from "@/platform/calendar";
import { computePayRun, DEFAULT_POLICY, payableDaysBasis, resolvePayDate } from "@/payroll-core";
import type {
  ComponentDefinition,
  EmployeeInput,
  PayrollLine,
  PayrollPolicy,
} from "@/payroll-core";
import {
  ComponentInput,
  PayrollSettings,
  DaysInput,
  EmployeePayrollInput,
  StructureInput,
  payrollErrorMessage,
  TemplateInput,
  type SalaryTemplate,
  type ComponentCategory,
  type EpfTreatment,
  type EmployeePayrollRow,
  type PayRunStatus,
  type PayRunSummary,
  type PayslipLine,
  type SalaryComponent,
  type StructureRow,
} from "./contracts";

/**
 * Postgres raises a bare code; this turns it into something an administrator
 * can read. The code survives in `details` so support can reach the real cause.
 *
 * The colon is part of the code — DUPLICATE_EMPLOYEE_CODE carries the code that
 * clashed, and stripping to the first colon would throw away the only piece of
 * information that makes the message actionable. Leave met this exact bug.
 */
function toPayrollError(message: string): AppError {
  const code = message.replace(/^ERROR:\s*/i, "").trim() || message;
  return new AppError("VALIDATION_FAILED", payrollErrorMessage(code), 400, { code });
}

/** What `payroll_run_inputs` returns. Mirrors the function's jsonb exactly. */
interface RunInputs {
  periodMonth: string;
  daysInMonth: number;
  status: PayRunStatus;
  components: {
    code: string;
    name: string;
    category: ComponentCategory;
    epf: EpfTreatment;
    proRata: boolean;
    order: number;
  }[];
  employees: {
    employeeId: string;
    employeeCode: string | null;
    employeeName: string | null;
    departmentName: string | null;
    daysPayable: number | null;
    arrears: number;
    tds: number;
    lwf: number;
    otherDeduction: number;
    fixedComponents: { code: string; amount: number }[];
  }[];
}

export interface ComputeResult {
  employeesPaid: number;
  /** Named, not counted — the screen has to say who was left out and why. */
  awaitingDays: { employeeId: string; employeeName: string | null; employeeCode: string | null }[];
  totals: { earnedGross: number; totalDeduction: number; netPayable: number };
}

export async function getRunInputs(runId: string): Promise<RunInputs> {
  const { data, error } = await supabase.rpc("payroll_run_inputs", { _run_id: runId });
  if (error) throw toPayrollError(error.message);
  return data as unknown as RunInputs;
}

export async function openRun(periodMonth: string): Promise<string> {
  const { data, error } = await supabase.rpc("payroll_open_run", { _period_month: periodMonth });
  if (error) throw toPayrollError(error.message);
  return data as string;
}

/**
 * Reads the inputs, runs the engine, stores the result.
 *
 * ANYBODY WITHOUT DAYS ENTERED IS LEFT OUT, and returned by name. The two
 * alternatives are both worse and both silent: defaulting to a full month pays
 * somebody nobody confirmed worked, and defaulting to zero issues a payslip
 * stating they earned nothing. Either would reconcile perfectly against itself,
 * which is how the spreadsheet loses its 45th employee.
 */
export async function computeRun(runId: string): Promise<ComputeResult> {
  const inputs = await getRunInputs(runId);

  const components: ComponentDefinition[] = inputs.components.map((c) => ({
    code: c.code,
    name: c.name,
    category: c.category,
    epf: c.epf,
    proRata: c.proRata,
    order: c.order,
  }));

  const awaitingDays = inputs.employees
    .filter((e) => e.daysPayable === null)
    .map((e) => ({
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      employeeCode: e.employeeCode,
    }));

  const payable = inputs.employees.filter((e) => e.daysPayable !== null);

  const engineInput: EmployeeInput[] = payable.map((e) => ({
    employeeCode: e.employeeId,
    departmentName: e.departmentName,
    fixedComponents: e.fixedComponents,
    daysPayable: e.daysPayable as number,
    arrears: e.arrears,
    tds: e.tds,
    lwf: e.lwf,
    otherDeduction: e.otherDeduction,
  }));

  const run = computePayRun(engineInput, components, await policyFor(inputs));

  // `employeeCode` carried the id through the engine, which has no concept of a
  // database key. Re-attach the real code and name for the frozen line.
  const byId = new Map(payable.map((e) => [e.employeeId, e]));
  const lines = run.lines.map((line) => toStoredLine(line, byId.get(line.employeeCode)));

  const { error } = await supabase.rpc("payroll_replace_run_lines", {
    _run_id: runId,
    _lines: lines as never,
  });
  if (error) throw toPayrollError(error.message);

  return {
    employeesPaid: run.lines.length,
    awaitingDays,
    totals: {
      earnedGross: run.totals.earnedGross,
      totalDeduction: run.totals.totalDeduction,
      netPayable: run.totals.netPayable,
    },
  };
}

function toStoredLine(line: PayrollLine, source: RunInputs["employees"][number] | undefined) {
  return {
    employeeId: line.employeeCode,
    employeeCode: source?.employeeCode ?? null,
    departmentName: line.departmentName,
    earnedComponents: line.earned,
    // Frozen alongside the earnings, and separate from `otherDeduction` — a
    // standing deduction and a one-off correction are different things, and a
    // payslip that merged them could explain neither.
    deductions: line.deductions,
    componentDeductions: line.componentDeductions,
    fixedGross: line.fixedGross,
    daysPayable: line.daysPayable,
    arrears: line.arrears,
    earnedGross: line.earnedGross,
    pfWages: line.pfWages,
    pfEmployee: line.pfEmployee,
    eps: line.eps,
    edli: line.edli,
    pfAdmin: line.pfAdmin,
    epsDifference: line.epsDifference,
    esiEligible: line.esiEligible,
    esiEmployee: line.esiEmployee,
    esiEmployer: line.esiEmployer,
    professionalTax: line.professionalTax,
    tds: line.tds,
    lwf: line.lwf,
    otherDeduction: line.otherDeduction,
    totalDeduction: line.totalDeduction,
    netPayable: line.netPayable,
    ncpDays: line.ncpDays,
  };
}

export async function submitRun(runId: string): Promise<string> {
  const { data, error } = await supabase.rpc("payroll_submit_run", { _run_id: runId });
  if (error) throw toPayrollError(error.message);
  return data as string;
}

// ─────────────────────────────────────────────────────────────── configuration

/**
 * Every component this organisation defines, in every category.
 *
 * `inUse` is derived here rather than stored: one query for which component ids
 * any salary structure line names. A stored flag and the structures it
 * describes drift, and it is the flag that lies — locking a component nobody is
 * on, or leaving one editable that half the workforce is paid through.
 *
 * The lookup is allowed to fail closed. If the structure lines cannot be read,
 * every component is treated as in use — the worst case is an administrator
 * being asked to create a new component instead of editing one, which is
 * inconvenient. The other direction lets somebody flip a component out of PF
 * wages and restate every payslip since April.
 */
export async function listComponents(): Promise<SalaryComponent[]> {
  const [components, used] = await Promise.all([
    supabase
      .from("salary_components")
      .select(
        "id, category, code, name, name_in_payslip, calculation_type, default_amount, default_percentage, epf, esi, is_taxable, is_pro_rata, is_fbp, show_on_payslip, part_of_structure, frequency, max_amount_per_month, unclaimed_policy, display_order, status",
      )
      .is("deleted_at", null)
      .order("display_order"),
    supabase.from("salary_structure_lines").select("component_id").is("deleted_at", null),
  ]);

  if (components.error) throw toPayrollError(components.error.message);

  const inUse = used.error ? null : new Set((used.data ?? []).map((r) => r.component_id as string));

  return (components.data ?? []).map((r) => ({
    id: r.id,
    category: r.category as SalaryComponent["category"],
    code: r.code,
    name: r.name,
    nameInPayslip: r.name_in_payslip ?? r.name,
    calculationType: r.calculation_type as SalaryComponent["calculationType"],
    defaultAmount: r.default_amount === null ? null : Number(r.default_amount),
    defaultPercentage: r.default_percentage === null ? null : Number(r.default_percentage),
    epf: r.epf as SalaryComponent["epf"],
    esi: r.esi,
    isTaxable: r.is_taxable,
    isProRata: r.is_pro_rata,
    isFbp: r.is_fbp,
    showOnPayslip: r.show_on_payslip,
    partOfStructure: r.part_of_structure,
    frequency: r.frequency as SalaryComponent["frequency"],
    maxAmountPerMonth: r.max_amount_per_month === null ? null : Number(r.max_amount_per_month),
    unclaimedPolicy: r.unclaimed_policy as SalaryComponent["unclaimedPolicy"],
    displayOrder: r.display_order,
    status: r.status as "active" | "archived",
    inUse: inUse === null ? true : inUse.has(r.id),
  }));
}

export async function saveComponent(input: ComponentInput): Promise<void> {
  const parsed = ComponentInput.parse(input);
  const row = {
    category: parsed.category,
    code: parsed.code,
    name: parsed.name,
    // Blank means "same as the internal name". Storing the fallback rather than
    // resolving it on every read means a payslip says the same thing after
    // somebody renames the component for their own convenience.
    name_in_payslip: parsed.nameInPayslip.trim() || parsed.name,
    calculation_type: parsed.calculationType,
    default_amount: parsed.defaultAmount,
    default_percentage: parsed.defaultPercentage,
    epf: parsed.epf,
    esi: parsed.esi,
    is_taxable: parsed.isTaxable,
    is_pro_rata: parsed.isProRata,
    is_fbp: parsed.isFbp,
    show_on_payslip: parsed.showOnPayslip,
    part_of_structure: parsed.partOfStructure,
    frequency: parsed.frequency,
    max_amount_per_month: parsed.maxAmountPerMonth,
    unclaimed_policy: parsed.unclaimedPolicy,
    display_order: parsed.displayOrder,
  };

  const { error } = parsed.id
    ? await supabase.from("salary_components").update(row).eq("id", parsed.id)
    : await supabase.from("salary_components").insert({
        ...row,
        organization_id: await currentOrgId(),
      });
  if (error) throw toPayrollError(error.message);
}

/**
 * Active or archived — the reversible half of the spec's "soft status, hard
 * delete". Deleting is a different, destructive action and is never conflated
 * with this one.
 */
export async function setComponentStatus(id: string, status: "active" | "archived"): Promise<void> {
  const { error } = await supabase.from("salary_components").update({ status }).eq("id", id);
  if (error) throw toPayrollError(error.message);
}

/**
 * Everybody a pay run would consider, in the order a pay run considers them.
 *
 * The filter is `is_active`, matching `payroll_run_inputs` exactly. A
 * configuration screen listing people the run will skip — or skipping people
 * the run will include — sends an administrator to look for a name that is not
 * there, or lets them set up somebody who will never be paid.
 */
async function roster(): Promise<
  { employeeId: string; employeeName: string | null; employeeCode: string | null }[]
> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("employee_code", { nullsFirst: false })
    .order("full_name");
  if (error) throw toPayrollError(error.message);

  return (data ?? []).map((r) => ({
    employeeId: r.id,
    employeeName: r.full_name,
    employeeCode: r.employee_code,
  }));
}

/**
 * The roster, each person carrying whatever statutory identifiers they have.
 *
 * EVERY ACTIVE PERSON APPEARS, including the ones with nothing filled in — they
 * are the entire point of the screen. A list of only the rows that exist in
 * `payroll_employee_details` would show an administrator their completed work
 * and hide what is left, which is the wrong half.
 */
export async function listEmployeePayroll(): Promise<EmployeePayrollRow[]> {
  const [people, details] = await Promise.all([
    roster(),
    supabase
      .from("payroll_employee_details")
      .select("employee_id, uan, esi_number, pan, bank_name, bank_account_number, bank_ifsc")
      .is("deleted_at", null),
  ]);
  if (details.error) throw toPayrollError(details.error.message);

  const byEmployee = new Map((details.data ?? []).map((d) => [d.employee_id, d]));

  return people.map((p) => {
    const d = byEmployee.get(p.employeeId);
    return {
      ...p,
      uan: d?.uan ?? null,
      esiNumber: d?.esi_number ?? null,
      pan: d?.pan ?? null,
      bankName: d?.bank_name ?? null,
      bankAccountNumber: d?.bank_account_number ?? null,
      bankIfsc: d?.bank_ifsc ?? null,
    };
  });
}

/**
 * The roster, each person carrying the structure a run would actually use.
 *
 * `effectiveFrom` null means no structure at all — the state that until now
 * removed somebody from the pay run entirely rather than flagging them
 * (20260823130000). It is surfaced here because this is the screen that fixes
 * it.
 *
 * The structure chosen is the latest one already in force, matching
 * `payroll_run_inputs`. A future-dated structure exists and is not shown as
 * current, because it is not.
 */
export async function listStructures(): Promise<StructureRow[]> {
  const [people, structures] = await Promise.all([
    roster(),
    supabase
      .from("salary_structures")
      .select("id, employee_id, effective_from, salary_structure_lines(component_id, amount)")
      .is("deleted_at", null)
      .lte("effective_from", new Date().toISOString().slice(0, 10))
      .order("effective_from", { ascending: false }),
  ]);
  if (structures.error) throw toPayrollError(structures.error.message);

  // Ordered newest first, so the first one seen for a person is the current
  // one. Later rows are older and must not overwrite it.
  const current = new Map<string, (typeof structures.data)[number]>();
  for (const s of structures.data ?? []) {
    if (!current.has(s.employee_id)) current.set(s.employee_id, s);
  }

  return people.map((p) => {
    const s = current.get(p.employeeId);
    const amounts = (s?.salary_structure_lines ?? []).map((l) => ({
      componentId: l.component_id,
      amount: Number(l.amount),
    }));
    return {
      ...p,
      effectiveFrom: s?.effective_from ?? null,
      amounts,
      // Derived, never stored. The workbook's components sum exactly to gross
      // for all 44 of its employees, so gross is what the parts add up to
      // rather than a number that could disagree with them.
      fixedGross: amounts.reduce((total, a) => total + a.amount, 0),
    };
  });
}

export async function saveEmployeePayroll(input: EmployeePayrollInput): Promise<void> {
  const parsed = EmployeePayrollInput.parse(input);
  // Empty means absent, not blank. A '' UAN fails the shape constraint, and the
  // form sends '' for every field nobody has filled in yet.
  const blankToNull = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);

  const { error } = await supabase.from("payroll_employee_details").upsert(
    {
      organization_id: await currentOrgId(),
      employee_id: parsed.employeeId,
      uan: blankToNull(parsed.uan),
      esi_number: blankToNull(parsed.esiNumber),
      pan: blankToNull(parsed.pan),
      bank_name: blankToNull(parsed.bankName),
      bank_account_number: blankToNull(parsed.bankAccountNumber),
      bank_ifsc: blankToNull(parsed.bankIfsc),
    },
    { onConflict: "employee_id" },
  );
  if (error) throw toPayrollError(error.message);
}

export async function saveStructure(input: StructureInput): Promise<void> {
  const parsed = StructureInput.parse(input);
  const orgId = await currentOrgId();

  const { data: structure, error: structureError } = await supabase
    .from("salary_structures")
    .upsert(
      {
        organization_id: orgId,
        employee_id: parsed.employeeId,
        effective_from: parsed.effectiveFrom,
      },
      { onConflict: "employee_id,effective_from" },
    )
    .select("id")
    .single();
  if (structureError) throw toPayrollError(structureError.message);

  const { error } = await supabase.from("salary_structure_lines").upsert(
    parsed.amounts.map((a) => ({
      organization_id: orgId,
      structure_id: structure.id,
      component_id: a.componentId,
      amount: a.amount,
    })),
    { onConflict: "structure_id,component_id" },
  );
  if (error) throw toPayrollError(error.message);
}

export async function saveDays(runId: string, input: DaysInput): Promise<void> {
  const parsed = DaysInput.parse(input);
  const { error } = await supabase.from("pay_run_days").upsert(
    {
      organization_id: await currentOrgId(),
      pay_run_id: runId,
      employee_id: parsed.employeeId,
      days_payable: parsed.daysPayable,
      arrears: parsed.arrears,
      tds: parsed.tds,
      lwf: parsed.lwf,
      other_deduction: parsed.otherDeduction,
    },
    { onConflict: "pay_run_id,employee_id" },
  );
  if (error) throw toPayrollError(error.message);
}

// ────────────────────────────────────────────────────────────────────── reading

export async function listRuns(): Promise<PayRunSummary[]> {
  const { data, error } = await supabase
    .from("pay_runs")
    .select(
      "id, period_month, days_in_month, status, computed_at, locked_at, pay_run_lines(earned_gross, total_deduction, net_payable)",
    )
    .is("deleted_at", null)
    .order("period_month", { ascending: false });
  if (error) throw toPayrollError(error.message);

  return (data ?? []).map((r) => {
    const lines = r.pay_run_lines ?? [];
    return {
      id: r.id,
      periodMonth: r.period_month,
      daysInMonth: r.days_in_month,
      status: r.status as PayRunStatus,
      computedAt: r.computed_at,
      lockedAt: r.locked_at,
      employees: lines.length,
      earnedGross: sum(lines, "earned_gross"),
      totalDeduction: sum(lines, "total_deduction"),
      netPayable: sum(lines, "net_payable"),
    };
  });
}

function sum<K extends string>(rows: Record<K, number>[], key: K): number {
  return rows.reduce((total, row) => total + Number(row[key]), 0);
}

export async function getRunLines(runId: string): Promise<PayslipLine[]> {
  const { data, error } = await supabase
    .from("pay_run_lines")
    .select("*, profiles(full_name)")
    .eq("pay_run_id", runId)
    .is("deleted_at", null)
    .order("employee_code", { nullsFirst: false });
  if (error) throw toPayrollError(error.message);

  return (data ?? []).map((r) => ({
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.profiles?.full_name ?? null,
    departmentName: r.department_name,
    earned: (r.earned_components as { code: string; amount: number }[]) ?? [],
    deductions: (r.deductions as { code: string; amount: number }[]) ?? [],
    edli: Number(r.edli ?? 0),
    pfAdmin: Number(r.pf_admin ?? 0),
    componentDeductions: Number(r.component_deductions ?? 0),
    fixedGross: Number(r.fixed_gross),
    daysPayable: Number(r.days_payable),
    arrears: Number(r.arrears),
    earnedGross: Number(r.earned_gross),
    pfWages: Number(r.pf_wages),
    pfEmployee: Number(r.pf_employee),
    eps: Number(r.eps),
    epsDifference: Number(r.eps_difference),
    esiEligible: r.esi_eligible,
    esiEmployee: Number(r.esi_employee),
    esiEmployer: Number(r.esi_employer),
    professionalTax: Number(r.professional_tax),
    tds: Number(r.tds),
    lwf: Number(r.lwf),
    otherDeduction: Number(r.other_deduction),
    totalDeduction: Number(r.total_deduction),
    netPayable: Number(r.net_payable),
    ncpDays: Number(r.ncp_days),
  }));
}

async function currentOrgId(): Promise<string> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) throw toPayrollError(error.message);
  return data as string;
}

// ═══════════════════════════════════════════════ configuration into arithmetic

/**
 * The organisation's statutory configuration, as the engine wants it.
 *
 * One place where percentages become fractions and a scheme's `enabled` flag
 * becomes a zero. Doing this at the call site instead would mean every future
 * caller of `computePayRun` reproducing the conversion, and one of them getting
 * `12` where the engine expects `0.12` — a hundredfold provident fund deduction
 * that every total would still reconcile against.
 *
 * A scheme that is off contributes ITS OWN defaults rather than the statutory
 * ones. Reading a disabled scheme's rate would let a rate somebody typed while
 * experimenting reach a pay run the moment they switched it on.
 */
export async function policyFor(inputs: {
  daysInMonth: number;
  periodMonth: string;
}): Promise<PayrollPolicy> {
  const { statutory, paySchedule } = await getPayrollSettings();
  const pct = (n: number) => n / 100;

  return {
    ...DEFAULT_POLICY,
    daysInMonth: payableDaysBasis(paySchedule, inputs.daysInMonth),
    periodMonth: Number(inputs.periodMonth.slice(5, 7)),

    epfEnabled: statutory.epf.enabled,
    pfWageCeiling: statutory.epf.wageCeiling,
    restrictPfWagesToCeiling: statutory.epf.restrictToCeiling,
    pfRate: pct(statutory.epf.employeeRate),
    epsRate: pct(statutory.epf.pensionRate),
    edliRate: statutory.epf.includeEdli ? pct(statutory.epf.edliRate) : 0,
    pfAdminRate: statutory.epf.includeAdminCharges ? pct(statutory.epf.adminChargeRate) : 0,

    esiEnabled: statutory.esi.enabled,
    esiGrossCeiling: statutory.esi.grossCeiling,
    esiEmployeeRate: pct(statutory.esi.employeeRate),
    esiEmployerRate: pct(statutory.esi.employerRate),

    // An empty band list is a state that levies no professional tax, which is
    // a different thing from a band charging nought — and reads more clearly.
    ptSlabs: statutory.pt.enabled ? statutory.pt.slabs : [],

    lwf: {
      enabled: statutory.lwf.enabled,
      employee: statutory.lwf.employee,
      employer: statutory.lwf.employer,
      cycle: statutory.lwf.cycle,
      deductInMonth: statutory.lwf.deductInMonth,
    },
  };
}

// ═══════════════════════════════════════════════════ pay schedule and portal

/**
 * This workspace's payroll configuration, with every unset field defaulted.
 *
 * Readable by everybody in the organisation, deliberately: an employee has to
 * be able to find out when they will be paid. Writing is refused by RLS, not
 * here.
 */
export async function getPayrollSettings(): Promise<PayrollSettings> {
  // Its own schema, not the registry's copy of it — this module must be
  // exercisable without the platform registry having been installed.
  return getModuleSettings<PayrollSettings>("payroll", PayrollSettings);
}

export async function savePayrollSettings(settings: PayrollSettings): Promise<PayrollSettings> {
  return saveModuleSettings(await currentOrgId(), "payroll", settings);
}

/**
 * The day a month's salary reaches an account, under a schedule you name.
 *
 * The arithmetic is `resolvePayDate` in `src/payroll-core`, which is pure and
 * takes the calendar as a predicate. This function is the part that cannot be
 * pure: it asks the PLATFORM's working calendar which days are closed, so the
 * date a salary lands on is decided by the same weekend and the same holiday
 * list that leave is counted against.
 *
 * Takes the schedule rather than reading it, so the configurations screen can show
 * what an unsaved choice would do. A preview computed from the saved value
 * would answer the previous question.
 *
 * The window runs from the first of the pay period to the last day of the month
 * after it — wide enough to contain either pay-date rule and the walk backwards
 * off a closed day, which from the 1st of the following month reaches exactly
 * the 1st of the period month.
 */
export async function previewPayDate(
  periodMonth: string,
  schedule: PayrollSettings["paySchedule"],
): Promise<string> {
  const orgId = await currentOrgId();

  const start = new Date(`${periodMonth}T00:00:00Z`);
  const windowEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 0));

  let closed = new Set<string>();
  try {
    const excluded = await getExcludedDays(
      orgId,
      periodMonth,
      windowEnd.toISOString().slice(0, 10),
    );
    closed = new Set(excluded.map((e) => e.day));
  } catch {
    // A calendar that will not answer must not mean no pay date at all. The
    // nominal date is still the configured one and is very nearly always right;
    // silence here would put "—" where an employee looks for a day.
  }

  return resolvePayDate(periodMonth, schedule, (day) => closed.has(day));
}

/** The same question, asked of what this organisation has actually saved. */
export async function getPayDate(periodMonth: string): Promise<string> {
  const settings = await getPayrollSettings();
  return previewPayDate(periodMonth, settings.paySchedule);
}

/**
 * How many days this run divides a monthly salary by.
 *
 * `actual_days` answers with the month's real length, which is what every pay
 * run has done until now. `fixed_days` answers with the same number every
 * month, and changes what people are paid — see `payableDaysBasis`.
 */
export async function getDaysBasis(daysInMonth: number): Promise<number> {
  const settings = await getPayrollSettings();
  return payableDaysBasis(settings.paySchedule, daysInMonth);
}

// ═════════════════════════════════════════════════════════════ salary templates

/**
 * The salary shapes this organisation uses, with their component amounts.
 *
 * `gross` is derived from the EARNING components only, and derived on read —
 * the same rule as a salary structure. A stored gross and the parts it is made
 * of drift, and it is the stored one that lies.
 */
export async function listTemplates(): Promise<SalaryTemplate[]> {
  const [templates, lines, components] = await Promise.all([
    supabase
      .from("salary_templates")
      .select("id, name, description")
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("salary_template_lines")
      .select("template_id, component_id, amount")
      .is("deleted_at", null),
    listComponents(),
  ]);

  if (templates.error) throw toPayrollError(templates.error.message);
  if (lines.error) throw toPayrollError(lines.error.message);

  const earning = new Set(components.filter((c) => c.category === "earning").map((c) => c.id));
  const byTemplate = new Map<string, { componentId: string; amount: number }[]>();
  for (const l of lines.data ?? []) {
    const list = byTemplate.get(l.template_id) ?? [];
    list.push({ componentId: l.component_id, amount: Number(l.amount) });
    byTemplate.set(l.template_id, list);
  }

  return (templates.data ?? []).map((t) => {
    const amounts = byTemplate.get(t.id) ?? [];
    return {
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      amounts,
      gross: amounts
        .filter((a) => earning.has(a.componentId))
        .reduce((sum, a) => sum + a.amount, 0),
    };
  });
}

/**
 * Creates or replaces a template and its lines.
 *
 * Lines are replaced rather than merged, for the same reason a recomputed pay
 * run is: a component dropped from the template has to STOP being in it, and a
 * merge leaves the old amount behind where nothing on screen shows it.
 */
export async function saveTemplate(input: TemplateInput): Promise<string> {
  const parsed = TemplateInput.parse(input);
  const orgId = await currentOrgId();

  let templateId = parsed.id;
  if (templateId) {
    const { error } = await supabase
      .from("salary_templates")
      .update({ name: parsed.name, description: parsed.description })
      .eq("id", templateId);
    if (error) throw toPayrollError(mapTemplateError(error.message));
  } else {
    const { data, error } = await supabase
      .from("salary_templates")
      .insert({ organization_id: orgId, name: parsed.name, description: parsed.description })
      .select("id")
      .single();
    if (error) throw toPayrollError(mapTemplateError(error.message));
    templateId = data.id;
  }

  // Soft-delete then re-insert, so an application that ran against the previous
  // shape last month can still be explained from the audit log.
  const { error: cleared } = await supabase
    .from("salary_template_lines")
    .update({ deleted_at: new Date().toISOString() })
    .eq("template_id", templateId)
    .is("deleted_at", null);
  if (cleared) throw toPayrollError(cleared.message);

  const { error } = await supabase.from("salary_template_lines").insert(
    parsed.amounts.map((a) => ({
      organization_id: orgId,
      template_id: templateId as string,
      component_id: a.componentId,
      amount: a.amount,
    })),
  );
  if (error) throw toPayrollError(error.message);

  return templateId as string;
}

export async function removeTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from("salary_templates")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw toPayrollError(error.message);
}

/** A unique-violation on the name, in words rather than as a constraint name. */
function mapTemplateError(message: string): string {
  return /uq_salary_template_name|duplicate key/i.test(message) ? "TEMPLATE_NAME_TAKEN" : message;
}

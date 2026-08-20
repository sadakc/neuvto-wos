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
import { computePayRun, DEFAULT_POLICY } from "@/payroll-core";
import type { ComponentDefinition, EmployeeInput, PayrollLine } from "@/payroll-core";
import {
  ComponentInput,
  DaysInput,
  EmployeePayrollInput,
  StructureInput,
  payrollErrorMessage,
  type PayRunStatus,
  type PayRunSummary,
  type PayslipLine,
  type SalaryComponent,
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
  components: { code: string; name: string; countsForPfWages: boolean; order: number }[];
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
    countsForPfWages: c.countsForPfWages,
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

  const run = computePayRun(engineInput, components, {
    ...DEFAULT_POLICY,
    daysInMonth: inputs.daysInMonth,
  });

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
    fixedGross: line.fixedGross,
    daysPayable: line.daysPayable,
    arrears: line.arrears,
    earnedGross: line.earnedGross,
    pfWages: line.pfWages,
    pfEmployee: line.pfEmployee,
    eps: line.eps,
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

export async function listComponents(): Promise<SalaryComponent[]> {
  const { data, error } = await supabase
    .from("salary_components")
    .select("id, code, name, counts_for_pf_wages, display_order, status")
    .is("deleted_at", null)
    .order("display_order");
  if (error) throw toPayrollError(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    countsForPfWages: r.counts_for_pf_wages,
    displayOrder: r.display_order,
    status: r.status as "active" | "archived",
  }));
}

export async function saveComponent(input: ComponentInput): Promise<void> {
  const parsed = ComponentInput.parse(input);
  const row = {
    code: parsed.code,
    name: parsed.name,
    counts_for_pf_wages: parsed.countsForPfWages,
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

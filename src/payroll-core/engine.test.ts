import { describe, it, expect } from "vitest";
import { computeEmployee, computePayRun, DEFAULT_POLICY } from "./engine";
import type { EmployeeInput, PayrollPolicy } from "./types";
import { COMPONENTS, DAYS_IN_MONTH, EMPLOYEES, EXPECTED_TOTALS } from "./__fixtures__/july-2026";

const POLICY: PayrollPolicy = { ...DEFAULT_POLICY, daysInMonth: DAYS_IN_MONTH };

const employee = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  employeeCode: "E1",
  departmentName: "Ops",
  fixedComponents: [
    { code: "basic", amount: 10000 },
    { code: "hra", amount: 4000 },
    { code: "conveyance", amount: 1600 },
    { code: "medical", amount: 1250 },
    { code: "other", amount: 3150 },
  ],
  daysPayable: 31,
  arrears: 0,
  tds: 0,
  lwf: 0,
  otherDeduction: 0,
  ...over,
});

/**
 * The acceptance criterion for this package.
 *
 * A real month, every employee, every figure, against what Excel actually
 * produced. Anything less than all 44 passing means the spreadsheet was
 * misread — and a misread payroll is wrong money in somebody's account.
 */
describe("July 2026, against the spreadsheet", () => {
  it.each(EMPLOYEES.map((e) => [e.employeeCode, e] as const))(
    "reproduces %s exactly",
    (_code, source) => {
      const line = computeEmployee(source, COMPONENTS, POLICY);

      expect(line.earnedGross).toBe(source.expected.earnedGross);
      expect(line.pfWages).toBe(source.expected.pfWages);
      expect(line.pfEmployee).toBe(source.expected.pfEmployee);
      expect(line.esiEmployee).toBe(source.expected.esiEmployee);
      expect(line.professionalTax).toBe(source.expected.professionalTax);
      expect(line.totalDeduction).toBe(source.expected.totalDeduction);
      expect(line.netPayable).toBe(source.expected.netPayable);
    },
  );

  it("totals to the workbook's own summary sheet", () => {
    const run = computePayRun(EMPLOYEES, COMPONENTS, POLICY);
    expect(run.totals).toEqual(EXPECTED_TOTALS);
  });

  it("splits into departments that add back up to the run", () => {
    const run = computePayRun(EMPLOYEES, COMPONENTS, POLICY);
    const summed = run.byDepartment.reduce((t, d) => t + d.netPayable, 0);
    expect(summed).toBe(run.totals.netPayable);
    expect(run.byDepartment.reduce((t, d) => t + d.employees, 0)).toBe(44);
  });

  /**
   * Proof the assertions above can fail.
   *
   * A golden test compared against itself passes whatever the code does. This
   * moves one rate and requires the output to move with it — so a future
   * engine that silently ignored the policy could not slip through green.
   */
  it("the golden figures move when the policy moves", () => {
    const wrong = computePayRun(EMPLOYEES, COMPONENTS, { ...POLICY, pfRate: 0.13 });
    expect(wrong.totals.netPayable).not.toBe(EXPECTED_TOTALS.netPayable);
  });
});

describe("ESI eligibility", () => {
  const fixedGrossOf = (gross: number) =>
    employee({ fixedComponents: [{ code: "basic", amount: gross }] });

  it("covers somebody exactly on the ceiling", () => {
    const line = computeEmployee(fixedGrossOf(21000), COMPONENTS, POLICY);
    expect(line.esiEligible).toBe(true);
    expect(line.esiEmployee).toBeGreaterThan(0);
  });

  it("excludes somebody one rupee above it", () => {
    const line = computeEmployee(fixedGrossOf(21001), COMPONENTS, POLICY);
    expect(line.esiEligible).toBe(false);
    expect(line.esiEmployee).toBe(0);
  });

  /**
   * The asymmetry, asserted rather than assumed. Eligibility reads FIXED gross,
   * so unpaid leave cannot pull a well-paid employee into ESI for a month.
   */
  it("stays out when unpaid leave drops earned gross below the ceiling", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 30000 }], daysPayable: 10 }),
      COMPONENTS,
      POLICY,
    );
    expect(line.earnedGross).toBeLessThan(POLICY.esiGrossCeiling);
    expect(line.esiEligible).toBe(false);
    expect(line.esiEmployee).toBe(0);
  });

  it("reports zero as not-eligible rather than as a computed nil", () => {
    const line = computeEmployee(fixedGrossOf(50000), COMPONENTS, POLICY);
    expect(line.esiEligible).toBe(false);
  });
});

describe("professional tax", () => {
  const atEarnedGross = (basic: number) =>
    computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: basic }] }),
      COMPONENTS,
      POLICY,
    );

  it("is nil at the threshold itself", () => {
    expect(atEarnedGross(24999).professionalTax).toBe(0);
  });

  it("applies one rupee above it", () => {
    expect(atEarnedGross(25000).professionalTax).toBe(200);
  });
});

describe("provident fund", () => {
  it("excludes HRA from PF wages", () => {
    const line = computeEmployee(
      employee({
        fixedComponents: [
          { code: "basic", amount: 5000 },
          { code: "hra", amount: 2000 },
        ],
      }),
      COMPONENTS,
      POLICY,
    );
    expect(line.earnedGross).toBe(7000);
    expect(line.pfWages).toBe(5000);
  });

  it("caps PF wages at the ceiling", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 60000 }] }),
      COMPONENTS,
      POLICY,
    );
    expect(line.pfWages).toBe(15000);
    expect(line.pfEmployee).toBe(1800);
  });

  it("does not floor PF wages — four days' work is four days' PF", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 20000 }], daysPayable: 4 }),
      COMPONENTS,
      POLICY,
    );
    expect(line.pfWages).toBeLessThan(POLICY.pfWageCeiling);
    expect(line.pfWages).toBe(line.earnedGross);
  });

  it("splits EPF into EPS and the difference the ECR reports", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 60000 }] }),
      COMPONENTS,
      POLICY,
    );
    expect(line.eps).toBe(1250);
    expect(line.epsDifference).toBe(line.pfEmployee - line.eps);
  });
});

describe("edge cases the spreadsheet cannot express", () => {
  it("pays nobody nothing when no days are payable", () => {
    const line = computeEmployee(employee({ daysPayable: 0 }), COMPONENTS, POLICY);
    expect(line.earnedGross).toBe(0);
    expect(line.netPayable).toBe(0);
    expect(line.ncpDays).toBe(31);
  });

  it("handles half days", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 3100 }], daysPayable: 26.5 }),
      COMPONENTS,
      POLICY,
    );
    expect(line.earnedGross).toBe(2650);
  });

  it("adds arrears into earned gross and into PF wages", () => {
    const withArrears = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 5000 }], arrears: 1000 }),
      COMPONENTS,
      POLICY,
    );
    expect(withArrears.earnedGross).toBe(6000);
    expect(withArrears.pfWages).toBe(6000);
  });

  it("subtracts hand-entered deductions without deriving them", () => {
    const line = computeEmployee(
      employee({
        fixedComponents: [{ code: "basic", amount: 5000 }],
        tds: 100,
        lwf: 20,
        otherDeduction: 30,
      }),
      COMPONENTS,
      POLICY,
    );
    expect(line.totalDeduction).toBe(line.pfEmployee + line.esiEmployee + 150);
  });

  /**
   * `department_id` is nullable on `profiles`, so a workspace with no
   * departments configured has everybody here. Dropping them would produce a
   * summary that does not add up to the run.
   */
  it("keeps people with no department in the summary", () => {
    const run = computePayRun(
      [
        employee({ employeeCode: "A", departmentName: null }),
        employee({ employeeCode: "B", departmentName: "Ops" }),
      ],
      COMPONENTS,
      POLICY,
    );
    expect(run.byDepartment).toHaveLength(2);
    expect(run.byDepartment.reduce((t, d) => t + d.employees, 0)).toBe(2);
  });

  it("returns an empty run rather than failing on no employees", () => {
    const run = computePayRun([], COMPONENTS, POLICY);
    expect(run.lines).toHaveLength(0);
    expect(run.totals.netPayable).toBe(0);
    expect(run.byDepartment).toHaveLength(0);
  });
});

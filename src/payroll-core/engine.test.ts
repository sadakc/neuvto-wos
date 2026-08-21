import { describe, it, expect } from "vitest";
import { computeEmployee, computePayRun, professionalTaxFor, DEFAULT_POLICY } from "./engine";
import { round0 } from "./money";
import type { EmployeeInput, PayrollPolicy } from "./types";
import { COMPONENTS, DAYS_IN_MONTH, EMPLOYEES, EXPECTED_TOTALS } from "./__fixtures__/july-2026";

const POLICY: PayrollPolicy = { ...DEFAULT_POLICY, daysInMonth: DAYS_IN_MONTH, periodMonth: 7 };

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

/**
 * The three things the workbook cannot prove.
 *
 * The golden fixture is one month of one spreadsheet, and that spreadsheet has
 * no conditional PF component, nothing paid whole regardless of days, and no
 * standing deduction. Mapping it into the categorised model left every figure
 * untouched — which is exactly why it cannot vouch for the new treatments.
 * These cases are written for them.
 */
describe("EPF: a component that counts only below the ceiling", () => {
  const withSpecial = [
    ...COMPONENTS,
    {
      code: "special",
      name: "Special allowance",
      category: "earning" as const,
      epf: "under_threshold" as const,
      proRata: true,
      order: 60,
    },
  ];

  const person = (basic: number, special: number) =>
    employee({
      fixedComponents: [
        { code: "basic", amount: basic },
        { code: "special", amount: special },
      ],
    });

  it("tops a low earner up towards the ceiling", () => {
    // Basic alone is 10,000 — under the 15,000 ceiling — so the special
    // allowance joins it. This is what an employer means by "consider for EPF
    // only when PF wage is below 15,000".
    const line = computeEmployee(person(10_000, 3_000), withSpecial, POLICY);
    expect(line.pfWages).toBe(13_000);
  });

  it("computes the same as `always` while wages are restricted to the ceiling", () => {
    // Worth stating rather than discovering. Capped, `min(base, cap)` and
    // `min(base + extra, cap)` agree above the ceiling and below it, so this
    // treatment is INVISIBLE while the cap is on. A test asserting 15,000 here
    // would pass with the condition deleted.
    const asAlways = withSpecial.map((c) =>
      c.code === "special" ? { ...c, epf: "always" as const } : c,
    );
    for (const [basic, special] of [
      [10_000, 3_000],
      [16_000, 5_000],
      [15_000, 4_000],
    ] as const) {
      expect(computeEmployee(person(basic, special), withSpecial, POLICY).pfWages).toBe(
        computeEmployee(person(basic, special), asAlways, POLICY).pfWages,
      );
    }
  });

  it("leaves a high earner alone once wages are NOT restricted to the ceiling", () => {
    // Where the treatment finally means something: "12% of actual PF wage".
    // Base is already over the ceiling, so the allowance is not added, and PF
    // is charged on 16,000 rather than 21,000.
    const actual: PayrollPolicy = { ...POLICY, restrictPfWagesToCeiling: false };
    expect(computeEmployee(person(16_000, 5_000), withSpecial, actual).pfWages).toBe(16_000);
  });

  it("still tops a low earner up when wages are not restricted", () => {
    const actual: PayrollPolicy = { ...POLICY, restrictPfWagesToCeiling: false };
    expect(computeEmployee(person(10_000, 3_000), withSpecial, actual).pfWages).toBe(13_000);
  });

  it("charges PF on the whole wage when the ceiling is not applied", () => {
    const actual: PayrollPolicy = { ...POLICY, restrictPfWagesToCeiling: false };
    const restricted = computeEmployee(person(30_000, 0), withSpecial, POLICY);
    const unrestricted = computeEmployee(person(30_000, 0), withSpecial, actual);
    expect(restricted.pfWages).toBe(15_000);
    expect(unrestricted.pfWages).toBe(30_000);
    expect(unrestricted.pfEmployee).toBe(3_600);
  });

  it("ignores a component switched off entirely", () => {
    const off = [
      ...COMPONENTS,
      {
        code: "special",
        name: "Special",
        category: "earning" as const,
        epf: "off" as const,
        proRata: true,
        order: 60,
      },
    ];
    const line = computeEmployee(person(10_000, 3_000), off, POLICY);
    expect(line.pfWages).toBe(10_000);
  });
});

describe("Proration: what is paid whole", () => {
  const withBonus = [
    ...COMPONENTS,
    {
      code: "joining",
      name: "Joining bonus",
      category: "earning" as const,
      epf: "off" as const,
      proRata: false,
      order: 60,
    },
  ];

  it("pays a non-prorated component in full on a part month", () => {
    // A joining bonus does not become 19/31 of itself because the person
    // started mid-month — which is the entire reason they are getting it.
    const line = computeEmployee(
      employee({
        fixedComponents: [
          { code: "basic", amount: 31_000 },
          { code: "joining", amount: 5_000 },
        ],
        daysPayable: 10,
      }),
      withBonus,
      POLICY,
    );

    expect(line.earned.find((c) => c.code === "joining")?.amount).toBe(5_000);
    expect(line.earned.find((c) => c.code === "basic")?.amount).toBe(10_000);
    expect(line.earnedGross).toBe(15_000);
  });
});

describe("Deductions carried by the salary structure", () => {
  const withRecovery = [
    ...COMPONENTS,
    {
      code: "canteen",
      name: "Canteen recovery",
      category: "deduction" as const,
      epf: "off" as const,
      proRata: false,
      order: 10,
    },
  ];

  const person = () =>
    employee({
      fixedComponents: [
        { code: "basic", amount: 20_000 },
        { code: "canteen", amount: 500 },
      ],
    });

  it("takes the amount off without touching gross", () => {
    // A deduction is not negative pay. Letting it into earned gross would
    // reduce PF wages and ESI along with it, so somebody with a canteen bill
    // would quietly contribute less to their own provident fund.
    const line = computeEmployee(person(), withRecovery, POLICY);

    expect(line.earnedGross).toBe(20_000);
    expect(line.earned.find((c) => c.code === "canteen")).toBeUndefined();
    expect(line.componentDeductions).toBe(500);
    expect(line.deductions).toEqual([{ code: "canteen", amount: 500 }]);
  });

  it("reaches the total deduction and therefore the net", () => {
    const withOut = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 20_000 }] }),
      withRecovery,
      POLICY,
    );
    const withIn = computeEmployee(person(), withRecovery, POLICY);

    expect(withIn.totalDeduction - withOut.totalDeduction).toBe(500);
    expect(withOut.netPayable - withIn.netPayable).toBe(500);
  });

  it("says nothing about a deduction this person does not have", () => {
    // Every employee is measured against every component the organisation
    // defines. A zero-rupee canteen line on the payslip of somebody who never
    // uses the canteen is noise that invites a question.
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 20_000 }] }),
      withRecovery,
      POLICY,
    );
    expect(line.deductions).toEqual([]);
    expect(line.componentDeductions).toBe(0);
  });
});

describe("Benefits and reimbursements are configured, not computed", () => {
  it("leaves a benefit out of the payslip entirely", () => {
    // Deliberate, and stated so nobody reads its absence as a bug. A benefit
    // needs a claims flow to mean anything; until it has one, computing it
    // would put a figure on a payslip that nothing behind it can honour.
    const withVpf = [
      ...COMPONENTS,
      {
        code: "vpf",
        name: "Voluntary provident fund",
        category: "benefit" as const,
        epf: "off" as const,
        proRata: true,
        order: 60,
      },
    ];
    const line = computeEmployee(
      employee({
        fixedComponents: [
          { code: "basic", amount: 20_000 },
          { code: "vpf", amount: 1_000 },
        ],
      }),
      withVpf,
      POLICY,
    );

    expect(line.earnedGross).toBe(20_000);
    expect(line.componentDeductions).toBe(0);
    expect(line.earned.find((c) => c.code === "vpf")).toBeUndefined();
  });
});

describe("Provident fund as a scheme that can be off", () => {
  const off: PayrollPolicy = { ...POLICY, epfEnabled: false };

  it("produces no contribution rather than a zero one", () => {
    // An establishment under twenty people is not required to register. A
    // payslip showing ₹0 provident fund implies a scheme that happens to have
    // deducted nothing, which is a different and misleading claim.
    const line = computeEmployee(employee(), COMPONENTS, off);
    expect(line.pfEmployee).toBe(0);
    expect(line.eps).toBe(0);
    expect(line.epsDifference).toBe(0);
  });

  it("takes the contribution out of the total deduction with it", () => {
    const on = computeEmployee(employee(), COMPONENTS, POLICY);
    const line = computeEmployee(employee(), COMPONENTS, off);
    expect(on.pfEmployee).toBeGreaterThan(0);
    expect(on.totalDeduction - line.totalDeduction).toBe(on.pfEmployee);
    expect(line.netPayable - on.netPayable).toBe(on.pfEmployee);
  });
});

describe("The employer-side contributions the PF return asks for", () => {
  it("charges nothing unless the organisation includes them", () => {
    const line = computeEmployee(employee(), COMPONENTS, POLICY);
    expect(line.edli).toBe(0);
    expect(line.pfAdmin).toBe(0);
  });

  it("charges them on PF wages, and never deducts them from anybody", () => {
    const withEmployer: PayrollPolicy = { ...POLICY, edliRate: 0.005, pfAdminRate: 0.005 };
    const plain = computeEmployee(employee(), COMPONENTS, POLICY);
    const line = computeEmployee(employee(), COMPONENTS, withEmployer);

    expect(line.edli).toBe(round0(line.pfWages * 0.005));
    expect(line.pfAdmin).toBe(round0(line.pfWages * 0.005));
    // The employee's side is untouched. These are the employer's cost.
    expect(line.totalDeduction).toBe(plain.totalDeduction);
    expect(line.netPayable).toBe(plain.netPayable);
  });
});

describe("Professional tax as bands rather than a threshold", () => {
  it("reproduces Karnataka's two", () => {
    expect(professionalTaxFor(24_999, POLICY.ptSlabs)).toBe(0);
    expect(professionalTaxFor(25_000, POLICY.ptSlabs)).toBe(200);
  });

  it("handles a state with three, which a threshold could not", () => {
    // Maharashtra's shape. The whole reason this is a list: encoding
    // Karnataka's two bands as THE shape means rewriting the engine to sell to
    // somebody in Pune.
    const maharashtra = [
      { upTo: 7_500, amount: 0 },
      { upTo: 10_000, amount: 175 },
      { upTo: null, amount: 200 },
    ];
    expect(professionalTaxFor(7_500, maharashtra)).toBe(0);
    expect(professionalTaxFor(7_501, maharashtra)).toBe(175);
    expect(professionalTaxFor(10_000, maharashtra)).toBe(175);
    expect(professionalTaxFor(10_001, maharashtra)).toBe(200);
  });

  it("charges nothing in a state that levies none", () => {
    // An empty list, not a band of nought — a state without the tax is not a
    // state with a zero rate, and the difference shows on the return.
    expect(professionalTaxFor(100_000, [])).toBe(0);
    const line = computeEmployee(employee(), COMPONENTS, { ...POLICY, ptSlabs: [] });
    expect(line.professionalTax).toBe(0);
  });
});

describe("Labour welfare fund, which is collected once a year", () => {
  const yearly: PayrollPolicy = {
    ...POLICY,
    lwf: { enabled: true, employee: 50, employer: 100, cycle: "yearly", deductInMonth: 12 },
  };

  it("takes nothing in the eleven months it is not due", () => {
    // periodMonth is July. The typed value is deliberately non-zero: a
    // configured scheme GOVERNS, and leaving the typed figure standing in the
    // other eleven months is how a yearly fund gets collected twelve times.
    const line = computeEmployee(employee({ lwf: 50 }), COMPONENTS, yearly);
    expect(line.lwf).toBe(0);
  });

  it("takes it in the month it is due", () => {
    const line = computeEmployee(employee({ lwf: 0 }), COMPONENTS, { ...yearly, periodMonth: 12 });
    expect(line.lwf).toBe(50);
  });

  it("takes it every month when the state collects monthly", () => {
    const monthly: PayrollPolicy = { ...yearly, lwf: { ...yearly.lwf, cycle: "monthly" } };
    expect(computeEmployee(employee({ lwf: 0 }), COMPONENTS, monthly).lwf).toBe(50);
  });

  it("leaves the typed figure alone while the scheme is off", () => {
    // The workbook hand-enters this column, and switching the scheme on is what
    // takes that job away. Until then the typed number is the answer.
    const line = computeEmployee(employee({ lwf: 37 }), COMPONENTS, POLICY);
    expect(line.lwf).toBe(37);
  });
});

describe("Employee state insurance as a scheme that can be off", () => {
  it("reports everybody as outside it, not as contributing nothing", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 10_000 }] }),
      COMPONENTS,
      { ...POLICY, esiEnabled: false },
    );
    expect(line.esiEligible).toBe(false);
    expect(line.esiEmployee).toBe(0);
    expect(line.esiEmployer).toBe(0);
  });

  it("still covers a low earner while it is on", () => {
    const line = computeEmployee(
      employee({ fixedComponents: [{ code: "basic", amount: 10_000 }] }),
      COMPONENTS,
      POLICY,
    );
    expect(line.esiEligible).toBe(true);
    expect(line.esiEmployee).toBeGreaterThan(0);
  });
});

/**
 * The seam between the engine and the database.
 *
 * `computeRun` reads inputs through one RPC, runs `src/payroll-core`, and
 * writes the result through another. Between those two calls it maps twenty-odd
 * fields by hand, and a single mistyped key there means a column silently
 * defaults to zero — somebody's PF quietly not deducted, with every total still
 * reconciling because the CHECK constraints only compare the numbers that
 * arrived.
 *
 * So this feeds the golden July 2026 fixture through the whole handler and
 * asserts the payload that would reach Postgres. The engine's own test proves
 * the arithmetic; this proves the arithmetic survives the journey.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EMPLOYEES, COMPONENTS, EXPECTED_TOTALS } from "@/payroll-core/__fixtures__/july-2026";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => rpc(name, args) },
}));

import { computeRun } from "./handlers";

/** The fixture, reshaped into what `payroll_run_inputs` actually returns. */
const runInputs = {
  periodMonth: "2026-07-01",
  daysInMonth: 31,
  status: "draft",
  components: COMPONENTS.map((c) => ({
    code: c.code,
    name: c.name,
    countsForPfWages: c.countsForPfWages,
    order: c.order,
  })),
  employees: EMPLOYEES.map((e) => ({
    employeeId: `id-${e.employeeCode}`,
    employeeCode: e.employeeCode,
    employeeName: null,
    departmentName: e.departmentName,
    daysPayable: e.daysPayable,
    arrears: e.arrears,
    tds: e.tds,
    lwf: e.lwf,
    otherDeduction: e.otherDeduction,
    fixedComponents: e.fixedComponents,
  })),
};

interface StoredLine {
  employeeId: string;
  employeeCode: string | null;
  earnedGross: number;
  pfEmployee: number;
  esiEmployee: number;
  esiEligible: boolean;
  professionalTax: number;
  totalDeduction: number;
  netPayable: number;
  earnedComponents: { code: string; amount: number }[];
}

function storedLines(): StoredLine[] {
  const call = rpc.mock.calls.find(([name]) => name === "payroll_replace_run_lines");
  return (call?.[1] as { _lines: StoredLine[] })._lines;
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockImplementation((name: string) =>
    name === "payroll_run_inputs"
      ? Promise.resolve({ data: runInputs, error: null })
      : Promise.resolve({ data: null, error: null }),
  );
});

describe("computeRun — the golden month, through the handler", () => {
  it("sends every one of the 44 employees to be stored", async () => {
    const result = await computeRun("run-1");
    expect(result.employeesPaid).toBe(44);
    expect(storedLines()).toHaveLength(44);
    expect(result.awaitingDays).toEqual([]);
  });

  it("reproduces each employee's figures in the stored payload", async () => {
    await computeRun("run-1");
    const byCode = new Map(storedLines().map((l) => [l.employeeCode, l]));

    for (const source of EMPLOYEES) {
      const stored = byCode.get(source.employeeCode);
      expect(stored, `no line stored for ${source.employeeCode}`).toBeDefined();
      expect(stored).toMatchObject({
        earnedGross: source.expected.earnedGross,
        pfEmployee: source.expected.pfEmployee,
        esiEmployee: source.expected.esiEmployee,
        professionalTax: source.expected.professionalTax,
        totalDeduction: source.expected.totalDeduction,
        netPayable: source.expected.netPayable,
      });
    }
  });

  it("totals to the workbook's own summary sheet", async () => {
    const result = await computeRun("run-1");
    expect(result.totals).toEqual({
      earnedGross: EXPECTED_TOTALS.earnedGross,
      totalDeduction: EXPECTED_TOTALS.totalDeduction,
      netPayable: EXPECTED_TOTALS.netPayable,
    });
  });

  /**
   * The engine has no concept of a database key, so `employeeCode` carries the
   * id through it and the real code is re-attached afterwards. Getting that
   * backwards stores a payslip against the wrong person while every total still
   * reconciles.
   */
  it("stores the database id and the employer's code in the right fields", async () => {
    await computeRun("run-1");
    for (const line of storedLines()) {
      expect(line.employeeId).toBe(`id-${line.employeeCode}`);
      expect(line.employeeCode).toMatch(/^TISR\d+$/);
    }
  });

  it("carries the component breakdown, not just the total", async () => {
    await computeRun("run-1");
    const line = storedLines()[0];
    expect(line.earnedComponents.map((c) => c.code)).toEqual([
      "basic",
      "hra",
      "conveyance",
      "medical",
      "other",
    ]);
    const sum = line.earnedComponents.reduce((t, c) => t + c.amount, 0);
    expect(sum).toBe(line.earnedGross);
  });

  it("marks the ESI-exempt as exempt rather than as a zero contribution", async () => {
    await computeRun("run-1");
    const lines = storedLines();
    const exempt = lines.filter((l) => !l.esiEligible);

    expect(exempt.length).toBeGreaterThan(0);
    for (const line of exempt) expect(line.esiEmployee).toBe(0);
    // And the covered majority genuinely pay something, so "all exempt" cannot
    // pass this test by accident.
    expect(lines.filter((l) => l.esiEligible && l.esiEmployee > 0).length).toBeGreaterThan(0);
  });
});

describe("computeRun — who is left out", () => {
  it("names anybody with no days entered and does not pay them", async () => {
    rpc.mockImplementation((name: string) =>
      name === "payroll_run_inputs"
        ? Promise.resolve({
            data: {
              ...runInputs,
              employees: [runInputs.employees[0], { ...runInputs.employees[1], daysPayable: null }],
            },
            error: null,
          })
        : Promise.resolve({ data: null, error: null }),
    );

    const result = await computeRun("run-1");

    expect(result.employeesPaid).toBe(1);
    expect(result.awaitingDays).toHaveLength(1);
    expect(result.awaitingDays[0].employeeCode).toBe(runInputs.employees[1].employeeCode);
    // Not paid a full month, and not issued a payslip saying they earned nothing.
    expect(storedLines()).toHaveLength(1);
  });
});

// @vitest-environment happy-dom
/**
 * What the pay run screen must say, and what it must never say quietly.
 *
 * The failure this module exists to end is silent omission: the workbook's
 * VLOOKUP range stops at row 49, so the 45th employee vanishes from PF, ESI,
 * the bank file and their own payslip with no error at all. Every assertion
 * here is about a person NOT being paid being visible.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PayRunSummary } from "../contracts";

const listRuns = vi.fn<() => Promise<PayRunSummary[]>>();
const getRunInputs = vi.fn();
const computeRun = vi.fn();
const openRun = vi.fn();
const submitRun = vi.fn();
const saveDays = vi.fn();

vi.mock("../handlers", () => ({
  listRuns: () => listRuns(),
  getRunInputs: (id: string) => getRunInputs(id),
  computeRun: (id: string) => computeRun(id),
  openRun: (m: string) => openRun(m),
  submitRun: (id: string) => submitRun(id),
  saveDays: (id: string, input: unknown) => saveDays(id, input),
}));

import PayRuns from "./PayRuns";

const run = (over: Partial<PayRunSummary> = {}): PayRunSummary => ({
  id: "run-1",
  periodMonth: "2026-07-01",
  daysInMonth: 31,
  status: "draft",
  computedAt: null,
  lockedAt: null,
  employees: 2,
  earnedGross: 100000,
  totalDeduction: 5000,
  netPayable: 95000,
  ...over,
});

const employee = (over: Record<string, unknown> = {}) => ({
  employeeId: "e1",
  employeeName: "Priya Employee",
  employeeCode: "TISR0009",
  departmentName: "Engineering",
  daysPayable: 31,
  arrears: 0,
  tds: 0,
  lwf: 0,
  otherDeduction: 0,
  fixedComponents: [{ code: "basic", amount: 10000 }],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  listRuns.mockResolvedValue([run()]);
  getRunInputs.mockResolvedValue({
    periodMonth: "2026-07-01",
    daysInMonth: 31,
    status: "draft",
    components: [],
    employees: [employee()],
  });
});

describe("Pay runs — nobody disappears quietly", () => {
  it("names the people with no days entered, rather than counting them", async () => {
    getRunInputs.mockResolvedValue({
      periodMonth: "2026-07-01",
      daysInMonth: 31,
      status: "draft",
      components: [],
      employees: [
        employee(),
        employee({ employeeId: "e2", employeeName: "Ravi Kumar", daysPayable: null }),
      ],
    });

    render(<PayRuns />);

    // The name, not "1 person". A count is a number somebody reads past.
    //
    // Scoped to the banner: the name appears in the table below as well, which
    // is correct and is not what this asserts. Priya, who HAS days, must not be
    // named here — a warning that lists everybody warns about nobody.
    const banner = await screen.findByTestId("awaiting-days-warning");
    expect(banner).toHaveTextContent("Ravi Kumar");
    expect(banner).toHaveTextContent(
      /left out of the run rather than paid a full month or nothing/i,
    );
    expect(banner).not.toHaveTextContent("Priya Employee");
  });

  it("names anybody who has no salary structure at all", async () => {
    getRunInputs.mockResolvedValue({
      periodMonth: "2026-07-01",
      daysInMonth: 31,
      status: "draft",
      components: [],
      employees: [employee({ employeeName: "Unset Person", fixedComponents: [] })],
    });

    render(<PayRuns />);

    const banner = await screen.findByTestId("no-structure-warning");
    expect(banner).toHaveTextContent(/no salary structure and cannot be paid/i);
    expect(banner).toHaveTextContent("Unset Person");
  });

  it("says nothing about missing days when everybody has them", async () => {
    render(<PayRuns />);
    await screen.findByRole("heading", { name: "Pay runs" });
    expect(screen.queryByText(/Waiting on days/i)).not.toBeInTheDocument();
  });
});

describe("Pay runs — an approved run is read-only", () => {
  it("disables the days input and both actions once submitted", async () => {
    listRuns.mockResolvedValue([run({ status: "pending_approval" })]);
    render(<PayRuns />);

    const days = await screen.findByLabelText(/Days payable for Priya Employee/i);
    expect(days).toBeDisabled();
    expect(screen.getByRole("button", { name: /Compute/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Submit for approval/i })).toBeDisabled();
    expect(screen.getByText(/can no longer be changed/i)).toBeInTheDocument();
  });

  it("leaves a draft run editable", async () => {
    render(<PayRuns />);
    const days = await screen.findByLabelText(/Days payable for Priya Employee/i);
    expect(days).toBeEnabled();
    expect(screen.getByRole("button", { name: /Compute/i })).toBeEnabled();
  });
});

describe("Pay runs — the empty state", () => {
  it("invites a first run rather than reporting a fault", async () => {
    listRuns.mockResolvedValue([]);
    render(<PayRuns />);
    expect(await screen.findByText(/No payroll has been run yet/i)).toBeInTheDocument();
  });
});

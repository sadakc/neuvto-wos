// @vitest-environment happy-dom
/**
 * A payslip has to distinguish "you are outside ESI" from "your ESI came to
 * nothing".
 *
 * The workbook renders both as 0 and cannot tell them apart, which is how a
 * return gets filed declaring forty-four members when eleven are covered. The
 * person most likely to ask why the line is blank is the one reading it.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PayRunSummary, PayslipLine } from "../contracts";

const listRuns = vi.fn<() => Promise<PayRunSummary[]>>();
const getRunLines = vi.fn<() => Promise<PayslipLine[]>>();

vi.mock("../handlers", () => ({
  listRuns: () => listRuns(),
  getRunLines: () => getRunLines(),
}));

import MyPayslip from "./MyPayslip";

const approvedRun: PayRunSummary = {
  id: "run-1",
  periodMonth: "2026-07-01",
  daysInMonth: 31,
  status: "approved",
  computedAt: "2026-08-01T00:00:00Z",
  lockedAt: "2026-08-01T00:00:00Z",
  employees: 1,
  earnedGross: 53226,
  totalDeduction: 2000,
  netPayable: 51226,
};

const line = (over: Partial<PayslipLine> = {}): PayslipLine => ({
  employeeId: "e1",
  employeeCode: "TISR0004",
  employeeName: "Sam Christopher",
  departmentName: "Engineering",
  earned: [{ code: "basic", amount: 26613 }],
  fixedGross: 55000,
  daysPayable: 30,
  arrears: 0,
  earnedGross: 53226,
  pfWages: 15000,
  pfEmployee: 1800,
  eps: 1250,
  epsDifference: 550,
  esiEligible: false,
  esiEmployee: 0,
  esiEmployer: 0,
  professionalTax: 200,
  tds: 0,
  lwf: 0,
  otherDeduction: 0,
  totalDeduction: 2000,
  netPayable: 51226,
  ncpDays: 1,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  listRuns.mockResolvedValue([approvedRun]);
  getRunLines.mockResolvedValue([line()]);
});

describe("Payslip — exempt is not zero", () => {
  it("says ESI does not apply rather than showing ₹0", async () => {
    render(<MyPayslip />);

    const row = (await screen.findByText("Employee state insurance")).closest("div");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/not applicable/i)).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("₹0")).not.toBeInTheDocument();
  });

  it("shows the amount when the person IS covered", async () => {
    getRunLines.mockResolvedValue([
      line({ esiEligible: true, esiEmployee: 138, totalDeduction: 2138, netPayable: 51088 }),
    ]);
    render(<MyPayslip />);

    const row = (await screen.findByText("Employee state insurance")).closest("div");
    expect(within(row as HTMLElement).getByText("₹138")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText(/not applicable/i)).not.toBeInTheDocument();
  });
});

describe("Payslip — which months are visible", () => {
  /**
   * A draft is still being worked on. A payslip somebody screenshots before the
   * numbers are final is a conversation nobody in payroll wants to have twice.
   */
  it("hides a run that has not been approved", async () => {
    listRuns.mockResolvedValue([{ ...approvedRun, status: "draft", lockedAt: null }]);
    render(<MyPayslip />);

    expect(await screen.findByText(/You have no payslips yet/i)).toBeInTheDocument();
    expect(getRunLines).not.toHaveBeenCalled();
  });

  it("shows a run that has been paid", async () => {
    listRuns.mockResolvedValue([{ ...approvedRun, status: "paid" }]);
    render(<MyPayslip />);
    expect(await screen.findByText("Net pay")).toBeInTheDocument();
  });

  it("invites nothing when there is nothing, rather than reporting a fault", async () => {
    listRuns.mockResolvedValue([]);
    render(<MyPayslip />);
    expect(await screen.findByText(/You have no payslips yet/i)).toBeInTheDocument();
  });
});

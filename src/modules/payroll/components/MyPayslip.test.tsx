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
import { PayrollSettings } from "../contracts";
import type { PayRunSummary, PayslipLine } from "../contracts";

const listRuns = vi.fn<() => Promise<PayRunSummary[]>>();
const getRunLines = vi.fn<() => Promise<PayslipLine[]>>();
const getPayrollSettings = vi.fn<() => Promise<PayrollSettings>>();
const getPayDate = vi.fn<() => Promise<string>>();

vi.mock("../handlers", () => ({
  listRuns: () => listRuns(),
  getRunLines: () => getRunLines(),
  getPayrollSettings: () => getPayrollSettings(),
  getPayDate: () => getPayDate(),
}));

const portal = (
  over: Partial<PayrollSettings["employeePortal"]> = {},
  slip: Partial<PayrollSettings["payslip"]> = {},
): PayrollSettings =>
  PayrollSettings.parse({
    payslip: slip,
    employeePortal: {
      payslipsVisible: true,
      showStatutoryBreakdown: true,
      showPayDate: true,
      ...over,
    },
  });

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
  deductions: [],
  componentDeductions: 0,
  edli: 0,
  pfAdmin: 0,
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
  getPayrollSettings.mockResolvedValue(portal());
  getPayDate.mockResolvedValue("2026-07-31");
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

describe("Payslip — the question an employee asks first", () => {
  it("says when the money lands, not only how much", async () => {
    // Sada's rule for the employee view is two facts: the slip, and when it is
    // credited. The second had no answer anywhere in the product before the pay
    // schedule existed — `pay_runs` knew the month and not the day.
    render(<MyPayslip />);
    const date = await screen.findByTestId("pay-date");
    expect(date).toHaveTextContent(/31 July 2026|July 31, 2026/);
  });

  it("still shows the payslip when the calendar cannot answer", async () => {
    // A pay date is worth having and is not worth blanking a payslip for.
    getPayDate.mockRejectedValue(new Error("calendar down"));
    render(<MyPayslip />);
    expect(await screen.findByText("Net pay")).toBeInTheDocument();
    expect(screen.queryByTestId("pay-date")).not.toBeInTheDocument();
  });

  it("offers a copy to keep", async () => {
    render(<MyPayslip />);
    expect(await screen.findByTestId("download-payslip")).toBeInTheDocument();
  });
});

describe("Payslip — what the administrator has decided to show", () => {
  it("says payslips are switched off rather than that none exist", async () => {
    // The distinction the screen has to make. Somebody paid for a year, told
    // "you have no payslips yet", is being told something untrue by the product
    // — and would reasonably conclude payroll had lost their record.
    getPayrollSettings.mockResolvedValue(portal({ payslipsVisible: false }));
    getRunLines.mockResolvedValue([]); // the policy already refused them

    render(<MyPayslip />);
    expect(await screen.findByTestId("payslips-switched-off")).toBeInTheDocument();
    expect(screen.queryByText(/You have no payslips yet/i)).not.toBeInTheDocument();
  });

  it("hides the itemised statutory lines but never the total", async () => {
    // Itemising is a layout choice. A deduction with neither explanation nor
    // total is just money gone, so the total is not the administrator's to hide.
    getPayrollSettings.mockResolvedValue(portal({ showStatutoryBreakdown: false }));
    render(<MyPayslip />);

    await screen.findByText("Net pay");
    expect(screen.queryByText("Provident fund")).not.toBeInTheDocument();
    expect(screen.getByText("Total deductions")).toBeInTheDocument();
    expect(screen.getByText("₹2,000")).toBeInTheDocument();
  });

  it("drops the credit date when it has been switched off", async () => {
    getPayrollSettings.mockResolvedValue(portal({ showPayDate: false }));
    render(<MyPayslip />);
    await screen.findByText("Net pay");
    expect(screen.queryByTestId("pay-date")).not.toBeInTheDocument();
    expect(getPayDate).not.toHaveBeenCalled();
  });
});

describe("Payslip — a standing deduction is always explained", () => {
  it("itemises it even when the statutory breakdown is switched off", async () => {
    // PF and ESI are statutory and predictable, and an administrator may
    // reasonably want a shorter payslip. A canteen recovery is not: hiding it
    // leaves an unexplained gap between gross and net, which is the one thing
    // an employee will ask about.
    getPayrollSettings.mockResolvedValue(portal({ showStatutoryBreakdown: false }));
    getRunLines.mockResolvedValue([
      line({
        deductions: [{ code: "canteen", amount: 450 }],
        componentDeductions: 450,
        totalDeduction: 2450,
        netPayable: 50776,
      }),
    ]);

    render(<MyPayslip />);
    await screen.findByText("Net pay");

    expect(screen.getByText("canteen")).toBeInTheDocument();
    expect(screen.getByText("₹450")).toBeInTheDocument();
    expect(screen.queryByText("Provident fund")).not.toBeInTheDocument();
  });
});

describe("Payslip — the layout the workspace chose", () => {
  it("drops the breakdown on the compact layout but never the two totals", async () => {
    getPayrollSettings.mockResolvedValue(portal({}, { layout: "compact" }));
    render(<MyPayslip />);

    const compact = await screen.findByTestId("payslip-compact");
    expect(compact).toHaveTextContent("Earned gross");
    expect(compact).toHaveTextContent("Total deductions");
    expect(screen.queryByText("Provident fund")).not.toBeInTheDocument();
  });

  it("keeps the breakdown on the standard layout", async () => {
    render(<MyPayslip />);
    await screen.findByText("Net pay");
    expect(screen.queryByTestId("payslip-compact")).not.toBeInTheDocument();
    expect(screen.getByText("Provident fund")).toBeInTheDocument();
  });

  it("prints the letterhead and the footer when they are set", async () => {
    getPayrollSettings.mockResolvedValue(
      portal({}, { letterhead: "12 MG Road, Madikeri", footerNote: "System generated." }),
    );
    render(<MyPayslip />);
    expect(await screen.findByTestId("payslip-letterhead")).toHaveTextContent("12 MG Road");
    expect(screen.getByTestId("payslip-footer")).toHaveTextContent("System generated.");
  });
});

describe("Payslip — an announcement that takes itself down", () => {
  it("shows a notice that has not expired", async () => {
    getPayrollSettings.mockResolvedValue(
      portal({ bannerMessage: "Salary is a day late this month.", bannerUntil: "2099-01-01" }),
    );
    render(<MyPayslip />);
    expect(await screen.findByTestId("portal-banner")).toHaveTextContent(/a day late/i);
  });

  it("hides one whose date has passed, rather than waiting to be remembered", async () => {
    // The failure this prevents: "salary is late this month" still on screen in
    // March, which teaches everybody to stop reading the banner.
    getPayrollSettings.mockResolvedValue(
      portal({ bannerMessage: "Salary is a day late this month.", bannerUntil: "2020-01-01" }),
    );
    render(<MyPayslip />);
    await screen.findByText("Net pay");
    expect(screen.queryByTestId("portal-banner")).not.toBeInTheDocument();
  });

  it("keeps a notice with no end date", async () => {
    getPayrollSettings.mockResolvedValue(portal({ bannerMessage: "Payroll closes on the 25th." }));
    render(<MyPayslip />);
    expect(await screen.findByTestId("portal-banner")).toBeInTheDocument();
  });

  it("says who to ask", async () => {
    getPayrollSettings.mockResolvedValue(
      portal({ contactName: "Hema", contactEmail: "hema@acme.test" }),
    );
    render(<MyPayslip />);
    expect(await screen.findByTestId("payslip-contact")).toHaveTextContent("hema@acme.test");
  });
});

// @vitest-environment happy-dom
/**
 * What this screen must not let an administrator believe.
 *
 * Three switches that look identical, and only one of them is a permission.
 * `payslipsVisible` is refused by the database; the other two decide how much of
 * an employee's own payslip is laid out for them. An administrator who cannot
 * tell those apart will eventually rely on the wrong one — so the screen labels
 * each with what actually backs it, and that label is asserted here rather than
 * left to a reading of the copy.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PayrollSettings } from "../contracts";

const getPayrollSettings = vi.fn<() => Promise<PayrollSettings>>();
const savePayrollSettings = vi.fn();

vi.mock("../handlers", () => ({
  getPayrollSettings: () => getPayrollSettings(),
  savePayrollSettings: (s: unknown) => savePayrollSettings(s),
}));

import EmployeePortal from "./EmployeePortal";

const settings = (over: Partial<PayrollSettings["employeePortal"]> = {}): PayrollSettings => ({
  // Deliberately NOT the schema defaults, for the same reason as the pay
  // schedule test: every field carries a `.default()`, so a fixture matching
  // them cannot tell a preserved value from a reset one.
  paySchedule: {
    calculationMethod: "fixed_days",
    fixedDays: 26,
    payDateRule: "day_of_next_month",
    payDay: 7,
  },
  employeePortal: {
    payslipsVisible: true,
    showStatutoryBreakdown: true,
    showPayDate: true,
    ...over,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  getPayrollSettings.mockResolvedValue(settings());
  savePayrollSettings.mockImplementation((s) => Promise.resolve(s));
});

describe("What employees see — a switch says what backs it", () => {
  it("marks the payslip switch as refused in the database", async () => {
    render(<EmployeePortal />);
    expect(await screen.findByTestId("enforcement-payslipsVisible")).toHaveTextContent(
      /refused in the database/i,
    );
  });

  it("marks the layout switches as display only, rather than implying more", async () => {
    // The honest half. Hiding somebody's own PF figure from them is a question
    // of detail on a screen, and calling it a permission would teach an
    // administrator to trust a control that protects nothing.
    render(<EmployeePortal />);
    expect(await screen.findByTestId("enforcement-showStatutoryBreakdown")).toHaveTextContent(
      /display only/i,
    );
    expect(screen.getByTestId("enforcement-showPayDate")).toHaveTextContent(/display only/i);
  });
});

describe("What employees see — flipping a switch", () => {
  it("saves the whole settings object, so the pay schedule survives", async () => {
    // One row per module in `module_settings`. Writing only `employeePortal`
    // would drop the pay schedule and quietly reset every payslip's credit date
    // to the default rule.
    const user = userEvent.setup();
    render(<EmployeePortal />);

    await user.click(await screen.findByTestId("toggle-payslipsVisible"));

    expect(savePayrollSettings).toHaveBeenCalledTimes(1);
    expect(savePayrollSettings.mock.calls[0][0]).toMatchObject({
      employeePortal: { payslipsVisible: false },
      paySchedule: { payDateRule: "day_of_next_month", payDay: 7, fixedDays: 26 },
    });
  });

  it("puts the switch back when the server refuses it", async () => {
    // A switch that looks flipped but did not save is an administrator
    // believing payslips are hidden while every employee can still read one.
    savePayrollSettings.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(<EmployeePortal />);

    const toggle = await screen.findByTestId("toggle-payslipsVisible");
    await user.click(toggle);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(toggle).toBeChecked();
  });

  it("shows what each switch currently says", async () => {
    getPayrollSettings.mockResolvedValue(settings({ payslipsVisible: false }));
    render(<EmployeePortal />);

    const row = (await screen.findByTestId("toggle-payslipsVisible")).closest("li");
    expect(within(row as HTMLElement).getByText("Hidden")).toBeInTheDocument();
  });
});

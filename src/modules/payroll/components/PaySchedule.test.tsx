// @vitest-environment happy-dom
/**
 * What the pay schedule screen has to get right.
 *
 * Two of these are about a preview being a preview. The screen shows the date
 * this month's salary would be credited on, and it has to compute that from the
 * choice on SCREEN rather than the one already saved — a preview of the stored
 * value answers the question before the one being asked, and looks correct
 * while doing it.
 *
 * The third is the conditional field: a day-of-month box next to a rule that
 * does not use one is a number somebody sets and then wonders why nothing
 * happened.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatutorySchemes, type PayrollSettings } from "../contracts";

const getPayrollSettings = vi.fn<() => Promise<PayrollSettings>>();
const savePayrollSettings = vi.fn();
const previewPayDate = vi.fn<(m: string, s: unknown) => Promise<string>>();
const getOrgToday = vi.fn<() => Promise<string>>();
const getCurrentUser = vi.fn();

vi.mock("../handlers", () => ({
  getPayrollSettings: () => getPayrollSettings(),
  savePayrollSettings: (s: unknown) => savePayrollSettings(s),
  previewPayDate: (m: string, s: unknown) => previewPayDate(m, s),
}));

vi.mock("@/platform/calendar", () => ({ getOrgToday: () => getOrgToday() }));
vi.mock("@/platform/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

import PaySchedule from "./PaySchedule";

const settings = (over: Partial<PayrollSettings["paySchedule"]> = {}): PayrollSettings => ({
  paySchedule: {
    calculationMethod: "actual_days",
    fixedDays: 30,
    payDateRule: "last_working_day",
    payDay: 1,
    ...over,
  },
  // Deliberately NOT the schema defaults. With every field carrying a
  // `.default()`, saving a partial object does not fail — Zod refills it — so a
  // fixture that matches the defaults cannot tell "preserved" from "reset". The
  // first version of this file did exactly that and passed a sabotage.
  statutory: StatutorySchemes.parse({}),
  employeePortal: { payslipsVisible: false, showStatutoryBreakdown: false, showPayDate: true },
});

beforeEach(() => {
  vi.resetAllMocks();
  getPayrollSettings.mockResolvedValue(settings());
  savePayrollSettings.mockImplementation((s) => Promise.resolve(s));
  previewPayDate.mockResolvedValue("2026-08-31");
  getOrgToday.mockResolvedValue("2026-08-21");
  getCurrentUser.mockResolvedValue({ organizationId: "o1" });
});

describe("Pay schedule — the date is shown, not described", () => {
  it("previews the month the ORGANISATION is in, not the browser", async () => {
    // A workspace in Madikeri configured from a laptop elsewhere should preview
    // its own month. `getOrgToday` is the platform's answer to that question.
    render(<PaySchedule />);
    await screen.findByTestId("pay-date-preview");
    expect(previewPayDate).toHaveBeenCalledWith("2026-08-01", expect.anything());
  });

  it("recomputes from the unsaved choice, not the stored one", async () => {
    const user = userEvent.setup();
    render(<PaySchedule />);
    await screen.findByTestId("pay-date-preview");

    await user.click(screen.getByRole("radio", { name: /A day of the month after/i }));

    // The saved value is still last_working_day. If the preview asked with that,
    // it would show a date the screen is no longer proposing.
    const last = previewPayDate.mock.calls.at(-1);
    expect(last?.[1]).toMatchObject({ payDateRule: "day_of_next_month" });
  });
});

describe("Pay schedule — a field that does nothing is not shown", () => {
  it("asks for a day number only when the rule uses one", async () => {
    const user = userEvent.setup();
    render(<PaySchedule />);
    await screen.findByTestId("pay-date-preview");

    expect(screen.queryByLabelText("Pay day of the month")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /A day of the month after/i }));
    expect(screen.getByLabelText("Pay day of the month")).toBeInTheDocument();
  });

  it("asks for a fixed day count only when proration uses one", async () => {
    const user = userEvent.setup();
    render(<PaySchedule />);
    await screen.findByTestId("pay-date-preview");

    expect(screen.queryByLabelText(/Fixed days per month/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /A fixed number of days/i }));
    expect(screen.getByLabelText(/Fixed days per month/i)).toBeInTheDocument();
  });
});

describe("Pay schedule — saving", () => {
  it("saves the whole settings object, not just the part on screen", async () => {
    // `module_settings` holds one row per module. Saving only the pay schedule
    // would write an object with no `employeePortal` key and silently reset
    // every switch on the other screen to its default.
    const user = userEvent.setup();
    render(<PaySchedule />);
    await screen.findByTestId("pay-date-preview");

    await user.click(screen.getByRole("radio", { name: /A fixed number of days/i }));
    await user.click(screen.getByTestId("save-pay-schedule"));

    expect(savePayrollSettings).toHaveBeenCalledTimes(1);
    expect(savePayrollSettings.mock.calls[0][0]).toMatchObject({
      paySchedule: { calculationMethod: "fixed_days" },
      employeePortal: { payslipsVisible: false, showStatutoryBreakdown: false },
    });
  });
});

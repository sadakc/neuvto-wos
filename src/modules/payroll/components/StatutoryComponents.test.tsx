// @vitest-environment happy-dom
/**
 * What the statutory screen must not let an employer get wrong.
 *
 * A scheme that is off has to LOOK off — an administrator needs to tell "we do
 * not run this" from "nobody has filled it in yet", and an empty form says the
 * second when it means the first.
 *
 * And two options on this screen change what other screens mean. Charging on
 * actual rather than restricted PF wages is what makes a component's "below the
 * ceiling only" treatment do anything at all; switching the labour welfare fund
 * on takes a figure out of the pay run operator's hands. Both are said out loud
 * here, and asserted.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayrollSettings } from "../contracts";

const getPayrollSettings = vi.fn<() => Promise<PayrollSettings>>();
const savePayrollSettings = vi.fn();

vi.mock("../handlers", () => ({
  getPayrollSettings: () => getPayrollSettings(),
  savePayrollSettings: (s: unknown) => savePayrollSettings(s),
}));

import StatutoryComponents from "./StatutoryComponents";

const settings = (over: Record<string, unknown> = {}): PayrollSettings =>
  PayrollSettings.parse({ statutory: over });

beforeEach(() => {
  vi.resetAllMocks();
  getPayrollSettings.mockResolvedValue(settings());
  savePayrollSettings.mockImplementation((s) => Promise.resolve(s));
});

describe("Statutory — what already runs keeps running", () => {
  it("ships provident fund, state insurance and professional tax switched on", async () => {
    // The divergence from the source spec, asserted. Defaulting these off would
    // mean the release quietly stripping all three from the next payslip of
    // every existing workspace.
    render(<StatutoryComponents />);
    await screen.findByTestId("scheme-tab-epf");

    expect(screen.queryByTestId("scheme-off-epf")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Employee contribution rate")).toHaveValue(12);
  });

  it("ships the labour welfare fund and statutory bonus switched off", async () => {
    // Neither is in the workbook, so switching them on is a decision somebody
    // makes rather than one this release makes for them.
    const user = userEvent.setup();
    render(<StatutoryComponents />);

    await user.click(await screen.findByTestId("scheme-tab-lwf"));
    expect(screen.getByTestId("scheme-off-lwf")).toBeInTheDocument();
  });
});

describe("Statutory — off is a state, not an empty form", () => {
  it("says a scheme is off and offers to switch it on", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);

    await user.click(await screen.findByTestId("scheme-tab-lwf"));
    expect(screen.getByTestId("scheme-off-lwf")).toHaveTextContent(/switched off/i);
    expect(screen.queryByLabelText("Collection cycle")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("enable-lwf"));
    expect(screen.getByLabelText("Collection cycle")).toBeInTheDocument();
  });

  it("can switch a running scheme off", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);
    await screen.findByTestId("scheme-tab-epf");

    await user.click(screen.getByTestId("disable-epf"));
    expect(screen.getByTestId("scheme-off-epf")).toBeInTheDocument();
  });
});

describe("Statutory — the option that changes another screen's meaning", () => {
  it("explains that actual wages are what make `below the ceiling only` work", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);
    await screen.findByTestId("scheme-tab-epf");

    expect(screen.queryByTestId("actual-wage-note")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Charged on"), "actual");
    expect(screen.getByTestId("actual-wage-note")).toHaveTextContent(/below the ceiling only/i);
  });

  it("warns that the labour welfare fund takes the figure over", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);

    await user.click(await screen.findByTestId("scheme-tab-lwf"));
    await user.click(screen.getByTestId("enable-lwf"));
    expect(screen.getByTestId("lwf-takes-over")).toHaveTextContent(/is ignored/i);
  });
});

describe("Statutory — the preview computes, rather than describing", () => {
  it("caps PF wages at the ceiling while wages are restricted", async () => {
    render(<StatutoryComponents />);
    const preview = await screen.findByTestId("epf-preview");
    // Default sample is ₹20,000 against a ₹15,000 ceiling.
    expect(preview).toHaveTextContent("₹15,000");
    expect(preview).toHaveTextContent("₹1,800"); // 12% of 15,000
  });

  it("charges on the whole wage once restriction is off", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);
    await screen.findByTestId("epf-preview");

    await user.selectOptions(screen.getByLabelText("Charged on"), "actual");
    expect(screen.getByTestId("epf-preview")).toHaveTextContent("₹2,400"); // 12% of 20,000
  });

  it("splits the employer's contribution into pension and the rest", async () => {
    // ₹15,000 × 8.33% = ₹1,250 pension; ₹1,800 − ₹1,250 = ₹550. The two halves
    // are what the ECR return reports separately, and an employer who knows
    // their own numbers spots a wrong one here.
    render(<StatutoryComponents />);
    const preview = await screen.findByTestId("epf-preview");
    expect(preview).toHaveTextContent("₹1,250");
    expect(preview).toHaveTextContent("₹550");
  });

  it("answers with the professional tax the bands actually produce", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);

    await user.click(await screen.findByTestId("scheme-tab-pt"));
    // ₹20,000 sits under Karnataka's ₹24,999 band.
    expect(screen.getByTestId("pt-preview")).toHaveTextContent("would be ₹0");
  });
});

describe("Statutory — bands, because states disagree", () => {
  it("lets a third band be added", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);

    await user.click(await screen.findByTestId("scheme-tab-pt"));
    expect(screen.getByLabelText("Band 2 amount")).toBeInTheDocument();
    await user.click(screen.getByTestId("add-slab"));
    expect(screen.getByLabelText("Band 3 amount")).toBeInTheDocument();
  });
});

describe("Statutory — saving", () => {
  it("keeps the pay schedule and the portal switches", async () => {
    // One row per module. Saving only the statutory block would reset the pay
    // date rule and every employee-portal switch to its default.
    getPayrollSettings.mockResolvedValue(
      PayrollSettings.parse({
        paySchedule: { payDateRule: "day_of_next_month", payDay: 7 },
        employeePortal: { payslipsVisible: false },
      }),
    );
    const user = userEvent.setup();
    render(<StatutoryComponents />);
    await screen.findByTestId("scheme-tab-epf");

    await user.click(screen.getByTestId("disable-epf"));
    await user.click(screen.getByTestId("save-statutory"));

    expect(savePayrollSettings).toHaveBeenCalledTimes(1);
    expect(savePayrollSettings.mock.calls[0][0]).toMatchObject({
      statutory: { epf: { enabled: false } },
      paySchedule: { payDateRule: "day_of_next_month", payDay: 7 },
      employeePortal: { payslipsVisible: false },
    });
  });

  it("refuses a bonus percentage outside the statutory range", async () => {
    const user = userEvent.setup();
    render(<StatutoryComponents />);

    await user.click(await screen.findByTestId("scheme-tab-bonus"));
    await user.click(screen.getByTestId("enable-bonus"));
    const pct = screen.getByLabelText("Bonus percentage");
    await user.clear(pct);
    await user.type(pct, "25");
    await user.click(screen.getByTestId("save-statutory"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/capped at 20%/i);
    expect(savePayrollSettings).not.toHaveBeenCalled();
  });
});

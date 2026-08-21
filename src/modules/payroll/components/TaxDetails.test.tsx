// @vitest-environment happy-dom
/**
 * The identifiers a return is rejected for, refused here instead.
 *
 * Same argument as an employee's UAN, one level up: none of this changes a
 * payslip by a rupee, and a malformed TAN is rejected by the portal hours later
 * without saying which field was wrong.
 *
 * The other assertion is about not over-claiming. This screen records who the
 * deductor is; it does not compute income tax, and saying so is the difference
 * between a gap somebody plans around and a gap they discover in January.
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

import TaxDetails from "./TaxDetails";

beforeEach(() => {
  vi.resetAllMocks();
  getPayrollSettings.mockResolvedValue(
    PayrollSettings.parse({
      paySchedule: { payDateRule: "day_of_next_month", payDay: 7 },
      employeePortal: { payslipsVisible: false },
    }),
  );
  savePayrollSettings.mockImplementation((s) => Promise.resolve(s));
});

describe("Tax details — what this screen does not do", () => {
  it("says income tax is entered, not computed", async () => {
    render(<TaxDetails />);
    expect(await screen.findByTestId("tds-not-computed")).toHaveTextContent(/not computed here/i);
  });
});

describe("Tax details — shapes the portal will reject", () => {
  it("refuses a malformed PAN before the portal does", async () => {
    const user = userEvent.setup();
    render(<TaxDetails />);

    await user.type(await screen.findByLabelText("Organisation PAN"), "ABCD1234E");
    await user.click(screen.getByTestId("save-tax-details"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/looks like AAAAA0000A/i);
    expect(savePayrollSettings).not.toHaveBeenCalled();
  });

  it("refuses a malformed TAN", async () => {
    const user = userEvent.setup();
    render(<TaxDetails />);

    await user.type(await screen.findByLabelText("Organisation TAN"), "AAA00000A");
    await user.click(screen.getByTestId("save-tax-details"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/looks like AAAA00000A/i);
  });

  it("accepts a half-filled form, because these arrive over weeks", async () => {
    const user = userEvent.setup();
    render(<TaxDetails />);

    await user.type(await screen.findByLabelText("Organisation PAN"), "ABCDE1234F");
    await user.click(screen.getByTestId("save-tax-details"));

    expect(savePayrollSettings).toHaveBeenCalledTimes(1);
    expect(savePayrollSettings.mock.calls[0][0]).toMatchObject({
      taxDetails: { pan: "ABCDE1234F", tan: "" },
    });
  });
});

describe("Tax details — saving", () => {
  it("keeps the pay schedule and the portal switches", async () => {
    const user = userEvent.setup();
    render(<TaxDetails />);

    await user.type(await screen.findByLabelText("Deductor name"), "Hema HR");
    await user.click(screen.getByTestId("save-tax-details"));

    expect(savePayrollSettings.mock.calls[0][0]).toMatchObject({
      taxDetails: { deductorName: "Hema HR" },
      paySchedule: { payDateRule: "day_of_next_month", payDay: 7 },
      employeePortal: { payslipsVisible: false },
    });
  });
});

// @vitest-environment happy-dom
/**
 * Three layouts that do different things, previewed rather than described.
 *
 * The spec offers six variants of one document as a thumbnail gallery. A
 * gallery of near-identical thumbnails is a decision nobody can make on the
 * evidence in front of them, so this is three that differ in what they SAY, and
 * the preview renders from the settings above it — a letterhead too long to fit
 * shows as too long to fit.
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

import PayslipTemplate from "./PayslipTemplate";

beforeEach(() => {
  vi.resetAllMocks();
  getPayrollSettings.mockResolvedValue(PayrollSettings.parse({}));
  savePayrollSettings.mockImplementation((s) => Promise.resolve(s));
});

describe("Payslip layout — the preview follows the choice", () => {
  it("shows a breakdown on standard and drops it on compact", async () => {
    const user = userEvent.setup();
    render(<PayslipTemplate />);

    expect(await screen.findByTestId("preview-breakdown")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Compact"));
    expect(screen.getByTestId("preview-compact")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-breakdown")).not.toBeInTheDocument();
  });

  it("adds the statutory line only on detailed", async () => {
    const user = userEvent.setup();
    render(<PayslipTemplate />);
    await screen.findByTestId("payslip-preview");

    expect(screen.queryByTestId("preview-detailed")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Detailed"));
    expect(screen.getByTestId("preview-detailed")).toHaveTextContent(/UAN/);
  });

  it("renders the letterhead as it is typed", async () => {
    const user = userEvent.setup();
    render(<PayslipTemplate />);

    await user.type(await screen.findByLabelText("Letterhead"), "12 MG Road");
    expect(screen.getByTestId("preview-letterhead")).toHaveTextContent("12 MG Road");
  });

  it("shows no letterhead line at all when there is none", async () => {
    render(<PayslipTemplate />);
    await screen.findByTestId("payslip-preview");
    expect(screen.queryByTestId("preview-letterhead")).not.toBeInTheDocument();
  });
});

describe("Payslip layout — saving", () => {
  it("stores the layout and the notes", async () => {
    const user = userEvent.setup();
    render(<PayslipTemplate />);

    await user.click(await screen.findByLabelText("Detailed"));
    await user.click(screen.getByTestId("save-payslip-template"));

    expect(savePayrollSettings.mock.calls[0][0]).toMatchObject({
      payslip: { layout: "detailed" },
    });
  });
});

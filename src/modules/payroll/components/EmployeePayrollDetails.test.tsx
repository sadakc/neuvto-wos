// @vitest-environment happy-dom
/**
 * What the statutory details screen must say.
 *
 * None of these fields changes a payslip by a rupee, which is exactly why they
 * get forgotten. The failure they cause arrives late and elsewhere: the EPFO
 * accepts an upload and rejects the batch hours later without naming a row, and
 * a missing account number is discovered when somebody is not paid.
 *
 * So the screen's job is to say who is incomplete, in the words of the file
 * that will reject them, while it can still be fixed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeePayrollRow } from "../contracts";

const listEmployeePayroll = vi.fn<() => Promise<EmployeePayrollRow[]>>();
const saveEmployeePayroll = vi.fn();

vi.mock("../handlers", () => ({
  listEmployeePayroll: () => listEmployeePayroll(),
  saveEmployeePayroll: (input: unknown) => saveEmployeePayroll(input),
}));

import EmployeePayrollDetails from "./EmployeePayrollDetails";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";

const complete = (over: Partial<EmployeePayrollRow> = {}): EmployeePayrollRow => ({
  employeeId: E1,
  employeeName: "Priya Employee",
  employeeCode: "TISR0009",
  uan: "100200300400",
  esiNumber: "3100123456",
  pan: "ABCDE1234F",
  bankName: "Canara Bank",
  bankAccountNumber: "0123456789",
  bankIfsc: "CNRB0001234",
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  listEmployeePayroll.mockResolvedValue([complete()]);
});

describe("Statutory details — who would fall out of a return", () => {
  it("names the people missing a UAN, and says which file drops them", async () => {
    listEmployeePayroll.mockResolvedValue([
      complete(),
      complete({ employeeId: E2, employeeName: "Ravi Kumar", uan: null }),
    ]);

    render(<EmployeePayrollDetails />);

    const banner = await screen.findByTestId("incomplete-details-warning");
    expect(banner).toHaveTextContent("Ravi Kumar");
    expect(banner).toHaveTextContent(/the PF return/i);
    expect(banner).not.toHaveTextContent("Priya Employee");
  });

  it("treats a missing account number and a missing IFSC alike — both stop the transfer", async () => {
    listEmployeePayroll.mockResolvedValue([
      complete({ employeeId: E2, employeeName: "No IFSC", bankIfsc: null }),
    ]);

    const banner = await (render(<EmployeePayrollDetails />),
    screen.findByTestId("incomplete-details-warning"));
    expect(banner).toHaveTextContent(/the bank file/i);
  });

  it("says nothing when everybody can be filed", async () => {
    render(<EmployeePayrollDetails />);
    await screen.findByText("Priya Employee");
    expect(screen.queryByTestId("incomplete-details-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId(`person-${E1}`)).toHaveTextContent("ready to file");
  });
});

describe("Statutory details — the shapes the portals demand", () => {
  it("refuses an eleven-digit UAN before the EPFO does", async () => {
    const user = userEvent.setup();
    render(<EmployeePayrollDetails />);

    await user.click(await screen.findByRole("button", { name: /Edit/i }));

    const uan = screen.getByLabelText(/UAN for Priya Employee/i);
    await user.clear(uan);
    await user.type(uan, "10020030040"); // eleven
    await user.click(screen.getByRole("button", { name: /Save details/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/exactly 12 digits/i);
    expect(saveEmployeePayroll).not.toHaveBeenCalled();
  });

  it("saves a half-filled form, because payroll is set up over weeks", async () => {
    listEmployeePayroll.mockResolvedValue([
      complete({ uan: null, esiNumber: null, pan: null, bankAccountNumber: null, bankIfsc: null }),
    ]);

    const user = userEvent.setup();
    render(<EmployeePayrollDetails />);

    await user.click(await screen.findByRole("button", { name: /Edit/i }));
    await user.type(screen.getByLabelText(/UAN for Priya Employee/i), "100200300400");
    await user.click(screen.getByRole("button", { name: /Save details/i }));

    expect(saveEmployeePayroll).toHaveBeenCalledTimes(1);
    expect(saveEmployeePayroll.mock.calls[0][0]).toMatchObject({
      employeeId: E1,
      uan: "100200300400",
      pan: "",
    });
  });
});

describe("Statutory details — the empty state", () => {
  it("points at the roster rather than reporting a fault", async () => {
    listEmployeePayroll.mockResolvedValue([]);
    render(<EmployeePayrollDetails />);
    expect(await screen.findByText(/Nobody active in this workspace yet/i)).toBeInTheDocument();
  });
});

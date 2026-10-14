// @vitest-environment happy-dom

/**
 * Applying for leave (Leave phase 2: unpaid leave and blackout periods). What
 * it pins:
 *
 * - an unpaid type shows no balance and no shortfall; it says the days are
 *   unpaid and how many have been taken and asked for this year;
 * - a paid type still shows its balance and still stops at a shortfall;
 * - dates over a blackout period say which one, and the request cannot be sent.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getLeaveTypes: vi.fn(),
  getMyBalances: vi.fn(),
  getMyUnpaid: vi.fn(),
  getBlackouts: vi.fn(),
  submitLeave: vi.fn(),
  getMyWorkingDays: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/platform/auth", () => ({
  getCurrentUser: async () => ({
    id: "ravi",
    email: "ravi@acme.test",
    fullName: "Ravi",
    organizationId: "org",
    organizationName: "Acme",
    roles: ["employee"],
  }),
  isModuleAdmin: () => false,
}));
vi.mock("@/platform/calendar", () => ({
  getMyWorkingDays: h.getMyWorkingDays,
  getMyExcludedDays: async () => [],
  describeExcludedDays: () => "",
}));
vi.mock("../handlers", () => ({
  getLeaveTypes: h.getLeaveTypes,
  getMyBalances: h.getMyBalances,
  getMyUnpaid: h.getMyUnpaid,
  getBlackouts: h.getBlackouts,
  submitLeave: h.submitLeave,
}));

import ApplyLeave from "./ApplyLeave";

beforeEach(() => {
  vi.resetAllMocks();
  h.getLeaveTypes.mockResolvedValue([
    { id: "casual", name: "Casual", kind: "paid" },
    { id: "lop", name: "Loss of pay", kind: "unpaid" },
  ]);
  h.getMyBalances.mockResolvedValue([
    {
      leaveTypeId: "casual",
      leaveTypeName: "Casual",
      fyLabel: "2099-00",
      entitledDays: 12,
      carryforwardDays: 0,
      usedDays: 10,
      reservedDays: 0,
      pendingDays: 0,
      availableDays: 2,
    },
  ]);
  h.getMyUnpaid.mockResolvedValue([
    { leaveTypeId: "lop", leaveTypeName: "Loss of pay", takenDays: 3, pendingDays: 1 },
  ]);
  h.getBlackouts.mockResolvedValue([
    { id: "b1", name: "Year-end audit", fromDate: "2099-03-23", toDate: "2099-03-27" },
  ]);
  h.getMyWorkingDays.mockResolvedValue(5);
});

async function choose(typeName: string, from: string, to: string) {
  const user = userEvent.setup();
  render(<ApplyLeave />);
  await user.selectOptions(await screen.findByLabelText("Leave type"), typeName);
  // Typed the way the box takes it, DD/MM/YYYY (the shared date picker).
  await user.type(screen.getByLabelText("First day"), dmy(from));
  await user.type(screen.getByLabelText("Last day"), dmy(to));
  return user;
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

describe("unpaid leave", () => {
  it("shows no balance and no shortfall, says it is unpaid, and what was taken", async () => {
    await choose("Loss of pay", "2099-01-05", "2099-01-09");
    const panel = await screen.findByTestId("unpaid-line");
    expect(panel).toHaveTextContent("Unpaid");
    expect(panel).toHaveTextContent("3 days taken this year");
    expect(panel).toHaveTextContent("1 awaiting a decision");
    expect(screen.queryByTestId("balance-line")).toBeNull();
    expect(screen.queryByTestId("shortfall")).toBeNull();
    // After the working-day count lands (debounced).
    await waitFor(() => expect(screen.getByTestId("submit-leave")).toBeEnabled());
  });

  it("still stops paid leave at a shortfall", async () => {
    await choose("Casual", "2099-01-05", "2099-01-09");
    expect(await screen.findByTestId("shortfall")).toHaveTextContent("have 2 available");
    expect(screen.queryByTestId("unpaid-line")).toBeNull();
    expect(screen.getByTestId("submit-leave")).toBeDisabled();
  });
});

describe("blackout periods", () => {
  it("names the blackout the dates fall in, and will not send", async () => {
    await choose("Loss of pay", "2099-03-26", "2099-03-30");
    expect(await screen.findByTestId("blackout")).toHaveTextContent("Year-end audit");
    // Once the count has landed, so the button is not merely disabled for counting.
    await screen.findByText("Requested:", { exact: false });
    // D102: counted on the applicant's own calendar, not the company's.
    await waitFor(() =>
      expect(h.getMyWorkingDays).toHaveBeenCalledWith("2099-03-26", "2099-03-30"),
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByTestId("submit-leave")).toBeDisabled();
  });

  it("says nothing for dates clear of every blackout", async () => {
    await choose("Loss of pay", "2099-03-30", "2099-04-03");
    await screen.findByTestId("unpaid-line");
    expect(screen.queryByTestId("blackout")).toBeNull();
  });
});

describe("the dates, typed DD/MM/YYYY (Core HR date picker, 14 Oct 2026)", () => {
  it("says a first day in the past can't be booked, and will not send it", async () => {
    // Unpaid: no balance to fall short of, so the past date is the only reason.
    await choose("Loss of pay", "2020-01-06", "2020-01-07");
    expect(screen.getByTestId("date-problem")).toHaveTextContent(
      "The first day can't be in the past.",
    );
    await screen.findByText("Requested:", { exact: false });
    expect(screen.getByTestId("submit-leave")).toBeDisabled();
  });

  it("asks for a whole date rather than taking half of one as none", async () => {
    const user = userEvent.setup();
    render(<ApplyLeave />);
    await user.selectOptions(await screen.findByLabelText("Leave type"), "Casual");
    await user.type(screen.getByLabelText("First day"), "05/01");
    expect(screen.getByTestId("date-problem")).toHaveTextContent("DD/MM/YYYY");
    expect(screen.getByTestId("submit-leave")).toBeDisabled();
  });

  it("reads a typed date and sends it as a date", async () => {
    h.submitLeave.mockResolvedValue(undefined);
    const user = await choose("Loss of pay", "2099-01-05", "2099-01-09");
    expect(screen.queryByTestId("date-problem")).toBeNull();
    expect(screen.getByLabelText("First day")).toHaveValue("05/01/2099");
    await waitFor(() => expect(screen.getByTestId("submit-leave")).toBeEnabled());
    await user.click(screen.getByTestId("submit-leave"));
    expect(h.submitLeave).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: "2099-01-05", toDate: "2099-01-09" }),
    );
  });
});

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
  await user.type(screen.getByLabelText("First day"), from);
  await user.type(screen.getByLabelText("Last day"), to);
  return user;
}

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

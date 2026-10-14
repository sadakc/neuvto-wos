// @vitest-environment happy-dom

/**
 * My leave's approval history (D87). What it pins: when a level moved up
 * because the approver had it longer than the target, the person who asked is
 * told who has it now and who it moved from; a level that never moved says
 * nothing of the kind.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getMyBalances: vi.fn(),
  getMyRequests: vi.fn(),
  getApprovalTimeline: vi.fn(),
  cancelLeave: vi.fn(),
  getLeaveTypes: vi.fn(),
}));
vi.mock("../handlers", () => h);
vi.mock("@/platform/modules", () => ({
  ModuleLink: ({ children, path }: { children?: React.ReactNode; path: string }) => (
    <a data-path={path}>{children}</a>
  ),
}));

import MyLeave from "./MyLeave";

beforeEach(() => {
  vi.resetAllMocks();
  h.getMyBalances.mockResolvedValue([]);
  h.getLeaveTypes.mockResolvedValue([{ id: "casual", name: "Casual", kind: "paid" }]);
  h.getMyRequests.mockResolvedValue([
    {
      id: "r1",
      approvalRequestId: "a1",
      leaveTypeId: "t",
      leaveTypeName: "Casual",
      fromDate: "2099-01-05",
      toDate: "2099-01-09",
      workingDays: 5,
      reason: null,
      status: "pending_approval",
      submittedAt: "2026-10-01T09:00:00Z",
      decidedAt: null,
      rejectionReason: null,
    },
  ]);
  h.getApprovalTimeline.mockResolvedValue([
    {
      level: 1,
      approverName: "Dan Director",
      decision: "pending",
      comments: null,
      decidedAt: null,
      escalatedFrom: "Mark Manager",
      escalatedAt: "2026-10-04T09:00:00Z",
    },
    {
      level: 2,
      approverName: "Hema HR",
      decision: "pending",
      comments: null,
      decidedAt: null,
      escalatedFrom: null,
      escalatedAt: null,
    },
  ]);
});

describe("the approval history", () => {
  it("says a level moved up, and from whom", async () => {
    const user = userEvent.setup();
    render(<MyLeave />);
    await user.click(await screen.findByTestId("request-row"));
    expect(await screen.findByText("Dan Director", { exact: false })).toBeInTheDocument();
    expect(
      screen.getAllByText(/Moved up from Mark Manager, who had it longer than the company allows/),
    ).toHaveLength(1);
  });
});

describe("compensatory off (D89)", () => {
  it("offers to claim it only where the company has it", async () => {
    const { unmount } = render(<MyLeave />);
    await screen.findByTestId("request-row");
    expect(screen.queryByText("Claim compensatory off")).toBeNull();
    unmount();
    h.getLeaveTypes.mockResolvedValue([{ id: "coff", name: "Comp off", kind: "earned" }]);
    render(<MyLeave />);
    expect(await screen.findByText("Claim compensatory off")).toHaveAttribute(
      "data-path",
      "leave/comp-off",
    );
  });
});

describe("monthly crediting (D90)", () => {
  it("says on the balance that a type is credited monthly, and only that one", async () => {
    const bal = (id: string, name: string) => ({
      leaveTypeId: id,
      leaveTypeName: name,
      fyLabel: "2026-27",
      entitledDays: 8.5,
      carryforwardDays: 0,
      usedDays: 0,
      reservedDays: 0,
      pendingDays: 0,
      availableDays: 8.5,
    });
    h.getMyBalances.mockResolvedValue([bal("el", "Earned leave"), bal("casual", "Casual")]);
    h.getLeaveTypes.mockResolvedValue([
      { id: "el", name: "Earned leave", kind: "paid", accrual: "monthly" },
      { id: "casual", name: "Casual", kind: "paid", accrual: "upfront" },
    ]);
    render(<MyLeave />);
    expect(await screen.findAllByText("Credited monthly: more each month")).toHaveLength(1);
    const card = screen.getByText("Credited monthly: more each month").closest("div.rounded-xl");
    expect(card).toHaveTextContent("Earned leave");
  });
});

describe("decided on somebody's behalf (D92)", () => {
  it("says who decided, when it was not the approver", async () => {
    const user = userEvent.setup();
    h.getApprovalTimeline.mockResolvedValue([
      {
        level: 1,
        approverName: "Mark Manager",
        decision: "approved",
        comments: null,
        decidedAt: "2026-10-04T09:00:00Z",
        decidedBy: "Hema HR",
      },
      {
        level: 2,
        approverName: "Dan Director",
        decision: "approved",
        comments: null,
        decidedAt: "2026-10-05T09:00:00Z",
        decidedBy: null,
      },
    ]);
    render(<MyLeave />);
    await user.click(await screen.findByTestId("request-row"));
    expect(await screen.findAllByText(/Decided by Hema HR on their behalf/)).toHaveLength(1);
  });
});

describe("the history, in the Core HR design (14 Oct 2026)", () => {
  it("sits in a History panel and writes its dates as the Employee Card does", async () => {
    render(<MyLeave />);
    const row = await screen.findByTestId("request-row");
    expect(screen.getByTestId("panel-history")).toContainElement(row);
    expect(row).toHaveTextContent("05 Jan 2099 to 09 Jan 2099");
    expect(row).not.toHaveTextContent("2099-01-05");
  });
});

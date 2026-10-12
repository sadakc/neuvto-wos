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
}));
vi.mock("../handlers", () => h);

import MyLeave from "./MyLeave";

beforeEach(() => {
  vi.resetAllMocks();
  h.getMyBalances.mockResolvedValue([]);
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

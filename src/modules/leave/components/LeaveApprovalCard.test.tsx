// @vitest-environment happy-dom

/**
 * Deciding one leave request (Leave phase 2). What it pins:
 *
 * - approving needs nothing more than the click; a comment is optional;
 * - rejecting is offered only once a reason is chosen and a note of at least
 *   three characters is written, and sends both;
 * - a rejected step in the history says its reason in words.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalQueueItem } from "@/platform/approvals";

const h = vi.hoisted(() => ({
  decideApproval: vi.fn(),
  getApprovalDetail: vi.fn(),
  getApprovalTimeline: vi.fn(),
}));

vi.mock("@/platform/approvals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/approvals")>()),
  decideApproval: h.decideApproval,
}));
vi.mock("../handlers", () => ({
  getApprovalDetail: h.getApprovalDetail,
  getApprovalTimeline: h.getApprovalTimeline,
}));

import LeaveApprovalCard from "./LeaveApprovalCard";

const item: ApprovalQueueItem = {
  approvalRequestId: "ar-1",
  entityType: "leave_request",
  entityId: "lr-1",
  requesterId: "ravi",
  requesterName: "Ravi Employee",
  level: 1,
  requiredLevels: 1,
  context: {},
  createdAt: "2026-10-10T09:00:00Z",
  daysWaiting: 2,
  levelSince: "2026-10-10T09:00:00Z",
  daysAtLevel: 2,
  targetDays: 2,
};

beforeEach(() => {
  vi.resetAllMocks();
  h.decideApproval.mockResolvedValue(undefined);
  h.getApprovalDetail.mockResolvedValue({
    leaveRequestId: "lr-1",
    employeeName: "Ravi Employee",
    leaveTypeId: "casual",
    leaveTypeName: "Casual",
    fromDate: "2026-11-02",
    toDate: "2026-11-02",
    workingDays: 1,
    reason: null,
    status: "pending_approval",
    entitledDays: 12,
    availableDays: 10,
  });
  h.getApprovalTimeline.mockResolvedValue([]);
});

describe("deciding a leave request", () => {
  it("approves with one click and no reason", async () => {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    render(<LeaveApprovalCard item={item} onDecided={onDecided} />);
    await user.click(await screen.findByTestId("approve"));
    expect(h.decideApproval).toHaveBeenCalledWith("ar-1", "approved", "", undefined);
    expect(onDecided).toHaveBeenCalled();
  });

  it("asks for a reason and a note before it will reject, and sends both", async () => {
    const user = userEvent.setup();
    render(<LeaveApprovalCard item={item} onDecided={() => {}} />);
    await user.click(await screen.findByTestId("reject"));
    const confirm = screen.getByTestId("confirm-reject");
    expect(confirm).toBeDisabled();

    await user.selectOptions(screen.getByTestId("reject-reason"), "business_need");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByTestId("reject-note"), "ok");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByTestId("reject-note"), " — the audit week");
    expect(confirm).toBeEnabled();
    expect(h.decideApproval).not.toHaveBeenCalled();

    await user.click(confirm);
    expect(h.decideApproval).toHaveBeenCalledWith(
      "ar-1",
      "rejected",
      "ok — the audit week",
      "business_need",
    );
  });

  it("says a rejection's reason in words in the history", async () => {
    const user = userEvent.setup();
    h.getApprovalTimeline.mockResolvedValue([
      {
        level: 1,
        approverName: "Mark Manager",
        decision: "rejected",
        comments: "Audit week",
        decidedAt: "2026-10-11T09:00:00Z",
        reasonCode: "insufficient_notice",
      },
    ]);
    render(<LeaveApprovalCard item={item} onDecided={() => {}} />);
    await user.click(await screen.findByText("Approval history"));
    expect(await screen.findByText(/Not enough notice/)).toBeInTheDocument();
  });
});

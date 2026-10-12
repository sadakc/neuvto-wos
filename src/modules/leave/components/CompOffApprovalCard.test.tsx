// @vitest-environment happy-dom

/**
 * Deciding a compensatory off claim (D89). What it pins:
 *
 * - the approver sees every day claimed, full or half, with its note, the
 *   total, and the reason in the person's words;
 * - proof, when attached, opens through a short-lived link the storage decides;
 * - what approving does is said: the days are credited, nothing before;
 * - approving and rejecting go through the same controls as leave, so a
 *   rejection still needs a reason and a note.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalQueueItem } from "@/platform/approvals";

const h = vi.hoisted(() => ({
  decideApproval: vi.fn(),
  getCompOffApprovalDetail: vi.fn(),
  getProofUrl: vi.fn(),
}));

vi.mock("@/platform/approvals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/approvals")>()),
  decideApproval: h.decideApproval,
}));
vi.mock("../handlers", () => ({
  getCompOffApprovalDetail: h.getCompOffApprovalDetail,
  getProofUrl: h.getProofUrl,
}));

import CompOffApprovalCard from "./CompOffApprovalCard";

const item: ApprovalQueueItem = {
  approvalRequestId: "ar-9",
  entityType: "comp_off_claim",
  entityId: "c-9",
  requesterId: "ravi",
  requesterName: "Ravi Employee",
  level: 1,
  requiredLevels: 1,
  context: { days: 1.5 },
  createdAt: "2026-10-10T09:00:00Z",
  daysWaiting: 1,
  levelSince: "2026-10-10T09:00:00Z",
  daysAtLevel: 1,
  targetDays: 2,
  escalatedFrom: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  h.decideApproval.mockResolvedValue(undefined);
  h.getCompOffApprovalDetail.mockResolvedValue({
    claimId: "c-9",
    employeeName: "Ravi Employee",
    leaveTypeName: "Comp off",
    reason: "Worked the audit weekend",
    totalDays: 1.5,
    status: "pending_approval",
    proofPath: "org/ravi/roster.pdf",
    days: [
      { date: "2026-10-04", days: 1, note: "Saturday" },
      { date: "2026-10-05", days: 0.5, note: null },
    ],
  });
  h.getProofUrl.mockResolvedValue("https://signed.example/roster.pdf");
});

describe("deciding a compensatory off claim", () => {
  it("shows every day, the total and the reason, and says what approving does", async () => {
    render(<CompOffApprovalCard item={item} onDecided={() => {}} />);
    const card = await screen.findByTestId("comp-off-approval");
    expect(card).toHaveTextContent("Comp off · 1.5 days claimed");
    expect(card).toHaveTextContent("4 Oct 2026 · full day · Saturday");
    expect(card).toHaveTextContent("5 Oct 2026 · half day");
    expect(card).toHaveTextContent("“Worked the audit weekend”");
    expect(card).toHaveTextContent("Approving credits 1.5 days to their Comp off.");
  });

  it("opens the proof through a short-lived link", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<CompOffApprovalCard item={item} onDecided={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Open the proof" }));
    expect(h.getProofUrl).toHaveBeenCalledWith("org/ravi/roster.pdf");
    expect(open).toHaveBeenCalledWith("https://signed.example/roster.pdf", "_blank", "noopener");
  });

  it("offers no proof link when none was attached", async () => {
    h.getCompOffApprovalDetail.mockResolvedValue({
      ...(await h.getCompOffApprovalDetail()),
      proofPath: null,
    });
    render(<CompOffApprovalCard item={item} onDecided={() => {}} />);
    await screen.findByTestId("comp-off-approval");
    expect(screen.queryByRole("button", { name: "Open the proof" })).toBeNull();
    expect(screen.getByText("No proof attached.")).toBeInTheDocument();
  });

  it("approves through the shared controls, and a rejection still needs a reason and a note", async () => {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    render(<CompOffApprovalCard item={item} onDecided={onDecided} />);
    await user.click(await screen.findByTestId("reject"));
    expect(screen.getByTestId("confirm-reject")).toBeDisabled();
    await user.click(screen.getByText("Back"));
    await user.click(screen.getByTestId("approve"));
    expect(h.decideApproval).toHaveBeenCalledWith("ar-9", "approved", "", undefined);
    expect(onDecided).toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom

/**
 * The approvals queue (Leave phase 2: approve selected, and how long it has
 * waited). What it pins:
 *
 * - each request can be selected, and "Approve selected" sends exactly those;
 * - what happened to each is said: how many were approved, and why any were not;
 * - the header says how long a request has waited at its level, and says when
 *   that is over the level's target. It never promises an escalation.
 */

import type { ComponentType } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalQueueItem } from "@/platform/approvals";

const h = vi.hoisted(() => ({
  listApprovalQueue: vi.fn(),
  approveMany: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));
vi.mock("@/platform/auth", () => ({
  getCurrentUser: async () => ({
    id: "mark",
    email: "mark@acme.test",
    fullName: "Mark Manager",
    organizationId: "org",
    organizationName: "Acme",
    roles: ["manager"],
  }),
}));
vi.mock("@/platform/approvals", () => ({
  listApprovalQueue: h.listApprovalQueue,
  approveMany: h.approveMany,
}));
vi.mock("@/platform/modules", () => ({ getApprovalViews: async () => new Map() }));

const { Route } = await import("./approvals");
const Page = (Route as unknown as { component: ComponentType }).component;

const row = (id: string, name: string, daysAtLevel: number, targetDays: number | null) =>
  ({
    approvalRequestId: id,
    entityType: "leave_request",
    entityId: `e-${id}`,
    requesterId: `u-${id}`,
    requesterName: name,
    level: 1,
    requiredLevels: 2,
    context: {},
    createdAt: "2026-10-01T09:00:00Z",
    daysWaiting: daysAtLevel,
    levelSince: "2026-10-01T09:00:00Z",
    daysAtLevel,
    targetDays,
  }) satisfies ApprovalQueueItem;

beforeEach(() => {
  vi.resetAllMocks();
  h.listApprovalQueue.mockResolvedValue([
    row("a", "Ravi Employee", 3, 2),
    row("b", "Priya Employee", 1, 2),
    row("c", "New Joiner", 0, null),
  ]);
});

const itemFor = async (name: string) =>
  (await screen.findByText(name)).closest('[data-testid="approval-item"]') as HTMLElement;

describe("how long it has waited", () => {
  it("says when a request is over its level's target, and promises no escalation", async () => {
    render(<Page />);
    expect(within(await itemFor("Ravi Employee")).getByTestId("waiting")).toHaveTextContent(
      "waiting 3 days at level 1 of 2 · over the 2-day target",
    );
    expect(within(await itemFor("Priya Employee")).getByTestId("waiting")).toHaveTextContent(
      "waiting 1 day at level 1 of 2 · target 2 days",
    );
    expect(within(await itemFor("New Joiner")).getByTestId("waiting")).toHaveTextContent(
      "reached level 1 of 2 today",
    );
    expect(screen.queryByText(/escalat/i)).toBeNull();
  });
});

describe("approve selected", () => {
  it("approves exactly the selected requests and says what happened to each", async () => {
    const user = userEvent.setup();
    h.approveMany.mockResolvedValue([
      { approvalRequestId: "a", approved: true, message: null },
      {
        approvalRequestId: "c",
        approved: false,
        message: "This has already been decided. Refresh to see where it ended up.",
      },
    ]);
    render(<Page />);
    expect(screen.queryByTestId("approve-selected")).toBeNull();

    await user.click(within(await itemFor("Ravi Employee")).getByRole("checkbox"));
    await user.click(within(await itemFor("New Joiner")).getByRole("checkbox"));
    const button = screen.getByTestId("approve-selected");
    expect(button).toHaveTextContent("Approve selected (2)");

    await user.click(button);
    expect(h.approveMany).toHaveBeenCalledWith(["a", "c"]);
    const result = await screen.findByTestId("bulk-result");
    expect(result).toHaveTextContent("1 approved.");
    expect(result).toHaveTextContent("New Joiner: This has already been decided.");
    expect(h.listApprovalQueue).toHaveBeenCalledTimes(2);
  });
});

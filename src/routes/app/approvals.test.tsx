// @vitest-environment happy-dom

/**
 * The approvals queue (Leave phase 2: approve selected, and how long it has
 * waited). What it pins:
 *
 * - each request can be selected, and "Approve selected" sends exactly those;
 * - what happened to each is said: how many were approved, and why any were not;
 * - the header says how long a request has waited at its level against the
 *   level's target, after which it moves up (D87), and says who it came from
 *   when it has.
 */

import type { ComponentType } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalQueueItem } from "@/platform/approvals";

const h = vi.hoisted(() => ({
  listApprovalQueue: vi.fn(),
  approveMany: vi.fn(),
  /** The page's ?m=, as the router holds it. */
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { search: h.search } }),
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
  isAdmin: (u: { roles: string[] } | null) =>
    !!u?.roles.some((r) => ["super_admin", "org_admin", "hr_admin"].includes(r)),
}));
vi.mock("@/platform/approvals", () => ({
  listApprovalQueue: h.listApprovalQueue,
  approveMany: h.approveMany,
}));
vi.mock("@/platform/modules", () => ({
  getApprovalViews: async () =>
    new Map([
      ["leave_request", { entityType: "leave_request", moduleKey: "leave", component: null }],
      ["record_change", { entityType: "record_change", moduleKey: "employee", component: null }],
    ]),
  moduleByKey: (key: string) =>
    key === "leave"
      ? { key, name: "Leave Management", shortName: "Leave" }
      : key === "employee"
        ? { key, name: "Employee Card" }
        : undefined,
  getHomeQueues: async () => [
    {
      id: "change-requests",
      moduleKey: "employee",
      title: "Change requests",
      component: () => <p data-testid="queue-body">Ravi asked for a change</p>,
    },
  ],
}));
vi.mock("@/platform/approvals/Delegations", () => ({
  Delegations: ({ modules, isAdmin }: { modules: { name: string }[]; isAdmin: boolean }) => (
    <p data-testid="delegations">
      {modules.map((m) => m.name).join(",")}|{String(isAdmin)}
    </p>
  ),
}));

const { Route } = await import("./approvals");
const Page = (Route as unknown as { component: ComponentType }).component;

const row = (
  id: string,
  name: string,
  daysAtLevel: number,
  targetDays: number | null,
  escalatedFrom: string | null = null,
  onBehalfOf: string | null = null,
) =>
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
    escalatedFrom,
    onBehalfOf,
  }) satisfies ApprovalQueueItem;

beforeEach(() => {
  vi.resetAllMocks();
  h.search = {};
  h.listApprovalQueue.mockResolvedValue([
    row("a", "Ravi Employee", 3, 2),
    row("b", "Priya Employee", 1, 2),
    row("c", "New Joiner", 0, null),
    row("d", "Dev Escalated", 0, 2, "Mark Manager"),
    row("e", "Esha Delegated", 0, 2, null, "Dan Director"),
  ]);
});

const itemFor = async (name: string) =>
  (await screen.findByText(name)).closest('[data-testid="approval-item"]') as HTMLElement;

describe("how long it has waited", () => {
  it("says how long it has waited against the target after which it moves up", async () => {
    render(<Page />);
    expect(within(await itemFor("Ravi Employee")).getByTestId("waiting")).toHaveTextContent(
      "waiting 3 days at level 1 of 2 · over the 2-day target, moving up",
    );
    expect(within(await itemFor("Priya Employee")).getByTestId("waiting")).toHaveTextContent(
      "waiting 1 day at level 1 of 2 · moves up after 2 days",
    );
    const joiner = await itemFor("New Joiner");
    expect(within(joiner).getByTestId("waiting")).toHaveTextContent("reached level 1 of 2 today");
    expect(within(joiner).getByTestId("waiting")).not.toHaveTextContent(/moves up/);
  });

  it("says who a request moved up from", async () => {
    render(<Page />);
    expect(within(await itemFor("Dev Escalated")).getByTestId("escalated-from")).toHaveTextContent(
      "Moved to you from Mark Manager, who had it longer than the target",
    );
    expect(within(await itemFor("Ravi Employee")).queryByTestId("escalated-from")).toBeNull();
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

describe("handing approvals over (D92)", () => {
  it("says whose approval a delegated request is", async () => {
    render(<Page />);
    expect(within(await itemFor("Esha Delegated")).getByTestId("on-behalf-of")).toHaveTextContent(
      "Dan Director's approval, handed to you while they are away",
    );
    expect(within(await itemFor("Ravi Employee")).queryByTestId("on-behalf-of")).toBeNull();
  });

  it("offers an approver the hand-over, with the workspace's modules that have approvals", async () => {
    render(<Page />);
    expect(await screen.findByTestId("delegations")).toHaveTextContent("Leave Management|false");
  });
});

describe("whose approvals (Sada, 14 Oct 2026)", () => {
  const change = { ...row("z", "Zara Changed", 0, null), entityType: "record_change" };

  it("opened from Leave: Leave approvals, and only leave requests", async () => {
    h.listApprovalQueue.mockResolvedValue([row("a", "Ravi Employee", 3, 2), change]);
    h.search = { m: "leave" };
    render(<Page />);
    expect(await screen.findByRole("heading", { name: "Leave approvals" })).toBeInTheDocument();
    expect(await screen.findByText("Ravi Employee")).toBeInTheDocument();
    expect(screen.queryByText("Zara Changed")).toBeNull();
  });

  it("opened from Home: everything waiting on you", async () => {
    h.listApprovalQueue.mockResolvedValue([row("a", "Ravi Employee", 3, 2), change]);
    render(<Page />);
    expect(await screen.findByRole("heading", { name: "Approvals" })).toBeInTheDocument();
    expect(await screen.findByText("Zara Changed")).toBeInTheDocument();
    expect(screen.getByText("Ravi Employee")).toBeInTheDocument();
  });
});

describe("Home's own lists (D111)", () => {
  it("puts what modules wait on their admins for, change requests, on Home's Approvals", async () => {
    render(<Page />);
    expect(await screen.findByTestId("home-queue-change-requests")).toHaveTextContent(
      "Change requests",
    );
    expect(screen.getByTestId("queue-body")).toHaveTextContent("Ravi asked for a change");
  });

  it("not on a module's own approvals", async () => {
    h.search = { m: "leave" };
    render(<Page />);
    await screen.findByRole("heading", { name: "Leave approvals" });
    expect(screen.queryByTestId("home-queue-change-requests")).toBeNull();
  });
});

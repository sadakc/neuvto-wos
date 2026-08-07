// @vitest-environment happy-dom

/**
 * Which roles may be named as an approver, and the one that may not.
 *
 * "Anyone with a role" is the rule that does not go through anybody's reporting
 * line — it names a role and every holder of it can sign off. Naming Employee
 * there would make every employee an approver of everybody, which is D57 read
 * backwards, and until D57 this `.filter()` was the ONLY thing preventing it:
 * `chain_role_present` demanded an approver_role alongside a `role` rule and had
 * no opinion at all about which one. The database now refuses it too. This file
 * is about the screen — a form that offers a choice the database will reject is
 * a form that wastes somebody's afternoon.
 *
 * The stored-level fixture is deliberately a Supervisor rather than the
 * `hr_admin` the form falls back to. A level stored as `supervisor` against a
 * label map that had never heard of the role still renders a `<select>` with the
 * right VALUE — and a completely blank box where the answer should be. That is
 * the "control misreports stored state" shape, and it is invisible to anything
 * that checks `select.value`.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApprovalLevel } from "@/platform/approvals";
import type { CurrentUser } from "@/platform/auth";

// ── the seam
//
// The router, the three approval-chain RPCs, and `getCurrentUser`. APP_ROLES,
// ROLE_LABELS, APPROVER_RULES and `isAdmin` are all REAL — they are the subject
// here, and a stub of any of them would leave this file asserting against its
// own fixture.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

const getCurrentUser = vi.fn<() => Promise<CurrentUser>>();

vi.mock("@/platform/auth", async () => {
  const { APP_ROLES, ROLE_LABELS } = await import("@/platform/auth/contracts");
  const { isAdmin } = await import("@/platform/auth/session");
  return { APP_ROLES, ROLE_LABELS, isAdmin, getCurrentUser: () => getCurrentUser() };
});

const listApprovalLevels = vi.fn<() => Promise<ApprovalLevel[]>>();
const saveApprovalLevel = vi.fn(async () => {});
const removeApprovalLevel = vi.fn(async () => {});

vi.mock("@/platform/approvals", async () => {
  // APPROVER_RULES kept real. The Supabase client it imports alongside is a lazy
  // Proxy that constructs nothing until a query runs, and no query runs here.
  const actual =
    await vi.importActual<typeof import("@/platform/approvals")>("@/platform/approvals");
  return {
    ...actual,
    listApprovalLevels: () => listApprovalLevels(),
    saveApprovalLevel: () => saveApprovalLevel(),
    removeApprovalLevel: () => removeApprovalLevel(),
  };
});

import { Route } from "./approval-rules";

/** Not exported; reached through the route options the mocked router returns. */
const ApprovalRulesPage = (Route as unknown as { component: () => React.ReactElement }).component;

const ADMIN: CurrentUser = {
  id: "alice-id",
  email: "alice.admin@acme.test",
  fullName: "Alice Admin",
  organizationId: "org",
  organizationName: "Acme",
  roles: ["org_admin"],
};

const LEVEL_1: ApprovalLevel = {
  id: "level-1",
  level: 1,
  approverRule: "reporting_manager",
  approverRole: null,
  conditionField: null,
  conditionOp: null,
  conditionValue: null,
  escalateAfterDays: 2,
};

/** Stored against `supervisor` — see the header. */
const LEVEL_2: ApprovalLevel = {
  id: "level-2",
  level: 2,
  approverRule: "role",
  approverRole: "supervisor",
  conditionField: "working_days",
  conditionOp: ">",
  conditionValue: 3,
  escalateAfterDays: 2,
};

async function renderRules() {
  render(<ApprovalRulesPage />);
  expect(await screen.findByText("Approval rules")).toBeInTheDocument();
}

/**
 * The "Which role" box on level 2 — the only level in this fixture whose rule is
 * "Anyone with a role". Scoped to that row rather than found across the whole
 * page, so that a box wrongly appearing on level 1 fails the one test that is
 * about where the box belongs, and does not muddy the three that are about what
 * is inside it.
 */
const whichRole = () =>
  within(screen.getAllByTestId("approval-level")[1]).getByLabelText(
    "Which role",
  ) as HTMLSelectElement;
const roleOptions = () =>
  (within(whichRole()).getAllByRole("option") as HTMLOptionElement[]).map((o) => [
    o.value,
    o.textContent,
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(ADMIN);
  listApprovalLevels.mockResolvedValue([LEVEL_1, LEVEL_2]);
});

describe("Approval rules — which roles may approve", () => {
  it("offers Supervisor and Coordinator alongside the roles that were always there", async () => {
    await renderRules();

    expect(roleOptions()).toEqual([
      ["org_admin", "Administrator"],
      ["hr_admin", "HR administrator"],
      ["manager", "Manager"],
      ["supervisor", "Supervisor"],
      ["coordinator", "Coordinator"],
    ]);
  });

  it("never offers Employee", async () => {
    // The rule the database now also enforces. Asserted on its own so that if
    // the list above changes for some other reason, the thing that must not
    // happen still has a test with its own name.
    await renderRules();

    expect(roleOptions().map(([value]) => value)).not.toContain("employee");
    expect(roleOptions().map(([, label]) => label)).not.toContain("Employee");
  });

  it("reports the role a level is actually stored with, in words", async () => {
    // `value` alone passes against a label map missing the role — the option is
    // there, correctly valued, and blank. What an administrator reads is the
    // selected option's text, so that is what is asserted.
    await renderRules();

    expect(whichRole().value).toBe("supervisor");
    expect(whichRole().selectedOptions[0].textContent).toBe("Supervisor");
  });

  it("shows the role box only for the rule that needs one", async () => {
    // "Their manager" resolves through the reporting line and takes no role.
    // A role box sitting under it would suggest the choice matters, and
    // `chain_role_present` refuses a role on any rule but this one.
    await renderRules();

    const levels = screen.getAllByTestId("approval-level");
    expect(within(levels[0]).queryByLabelText("Which role")).toBeNull();
    expect(within(levels[1]).getByLabelText("Which role")).toBeInTheDocument();
  });

  it("keeps offering every role after the rule is switched to Anyone with a role", async () => {
    // The box appears on a change rather than on load, which is a different
    // render path — and it is the path an administrator actually takes, since
    // level 1 arrives as "Their manager".
    const user = userEvent.setup();
    await renderRules();

    const levelOne = screen.getAllByTestId("approval-level")[0];
    await user.selectOptions(within(levelOne).getByLabelText("Who approves"), "role");

    const box = within(levelOne).getByLabelText("Which role") as HTMLSelectElement;
    const labels = (within(box).getAllByRole("option") as HTMLOptionElement[]).map(
      (o) => o.textContent,
    );
    expect(labels).toEqual([
      "Administrator",
      "HR administrator",
      "Manager",
      "Supervisor",
      "Coordinator",
    ]);
    // It defaults to HR administrator, and says so rather than opening blank.
    expect(box.selectedOptions[0].textContent).toBe("HR administrator");
  });
});

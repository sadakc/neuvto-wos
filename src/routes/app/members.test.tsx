// @vitest-environment happy-dom

/**
 * The first render test in this project, and it exists because of a specific
 * bug.
 *
 * Searching for one person on the People screen changed every "Reports to"
 * field to "Nobody". Nothing was written and the database never changed — the
 * dropdown's options had been built from the SEARCH-FILTERED list, so the
 * option for somebody's actual manager no longer existed, and a <select> whose
 * value is absent from its options renders the first one instead.
 *
 * Sada found it by using the app. Nothing else could have: `bun run lint`,
 * `bun run typecheck`, 123 unit tests and the full SQL harness were all green,
 * because every test in this project was a pure function and the entire class
 * of "the control is lying about saved state" lives above them.
 *
 * That is what this file is for. Not coverage — the specific promise that a
 * control on screen reports what is actually stored.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── the seam
//
// members.tsx reaches for the router at module load and for the database on
// mount. Both are replaced here so the test is about the component's own logic:
// given these people and this search, what does it show?

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock("@/platform/auth/InviteTeam", () => ({
  InviteTeam: () => null,
}));

const MARK = "mark-id";
const RAVI = "ravi-id";
const PRIYA = "priya-id";

const MEMBERS = [
  {
    id: MARK,
    fullName: "Mark Manager",
    email: "mark.manager@acme.test",
    phone: null,
    joinedDate: "2020-01-01",
    isActive: true,
    managerId: null,
    roles: ["manager"],
  },
  {
    id: RAVI,
    fullName: "Ravi Employee",
    email: "ravi.emp@acme.test",
    phone: null,
    joinedDate: "2021-06-15",
    isActive: true,
    // The whole point: Ravi reports to Mark, and a search for "ravi" removes
    // Mark from the list.
    managerId: MARK,
    roles: ["employee"],
  },
  {
    id: PRIYA,
    fullName: "Priya Employee",
    email: "priya.emp@acme.test",
    phone: null,
    joinedDate: "2022-03-01",
    isActive: true,
    managerId: MARK,
    roles: ["employee"],
  },
];

vi.mock("@/platform/auth", () => ({
  getCurrentUser: async () => ({
    id: "alice-id",
    email: "alice.admin@acme.test",
    fullName: "Alice Admin",
    organizationId: "org",
    organizationName: "Acme",
    roles: ["org_admin"],
  }),
  isAdmin: () => true,
  listMembers: async () => MEMBERS,
  listInvitations: async () => [],
  deactivateMember: vi.fn(),
  deactivationImpact: vi.fn(),
  reactivateMember: vi.fn(),
  revokeInvitation: vi.fn(),
  setJoinedDate: vi.fn(),
  setReportingLine: vi.fn(),
}));

import { MembersPage } from "./members";

async function renderPeople() {
  render(<MembersPage />);
  // The page loads its data on mount; wait for the skeleton to give way.
  expect(await screen.findByText("In this workspace")).toBeInTheDocument();
}

describe("People — search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still reports the right manager when the manager is filtered out", async () => {
    // THE REGRESSION. Before the fix this select rendered "Nobody", because
    // Mark was not among its options and a <select> falls back to the first.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "ravi");

    const rows = screen.getAllByTestId("member-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Ravi Employee")).toBeInTheDocument();

    const select = within(rows[0]).getByTestId("reporting-line") as HTMLSelectElement;
    expect(select.value).toBe(MARK);
    // And the option is genuinely present — a value alone would pass even if
    // the browser were rendering a blank.
    expect(within(select).getByRole("option", { name: "Mark Manager" })).toBeInTheDocument();
    expect(select.selectedOptions[0].textContent).toBe("Mark Manager");
  });

  it("offers every active person as a manager, not just the ones matching", async () => {
    // The same fault seen from the other side: an administrator who searches to
    // FIND somebody must still be able to give them any manager.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "ravi");

    const select = within(screen.getAllByTestId("member-row")[0]).getByTestId("reporting-line");
    const names = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toContain("Mark Manager");
    expect(names).toContain("Priya Employee");
    // Never themselves — that is a reporting loop.
    expect(names).not.toContain("Ravi Employee");
  });

  it("narrows the list as you type, and matches on email as well as name", async () => {
    const user = userEvent.setup();
    await renderPeople();

    expect(screen.getAllByTestId("member-row")).toHaveLength(3);

    await user.type(screen.getByTestId("people-search"), "priya.emp@");
    expect(screen.getAllByTestId("member-row")).toHaveLength(1);
    expect(screen.getByText("Priya Employee")).toBeInTheDocument();
  });

  it("says nothing matched rather than showing an empty list", async () => {
    // "No people" and "no people called Zebedee" are different answers, and the
    // second one is usually a typo.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "zebedee");
    expect(screen.getByTestId("people-no-match")).toBeInTheDocument();
    expect(screen.queryAllByTestId("member-row")).toHaveLength(0);
  });

  it("is present without waiting for the workspace to get big", async () => {
    // It was briefly hidden below nine people, which put it one person under
    // the threshold in the first workspace it met and read as missing.
    await renderPeople();
    expect(screen.getByTestId("people-search")).toBeInTheDocument();
  });
});

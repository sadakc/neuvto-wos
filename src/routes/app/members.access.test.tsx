// @vitest-environment happy-dom

/**
 * D78 — People's "Change access" panel, and who may make an administrator.
 *
 * `AccessEditor.test.tsx` pins the panel on its own: which roles each caller is
 * offered, what it sends back. What it cannot pin is what People does with it:
 * whose row gets the control, whose id the save goes out under, where a refusal
 * lands, and which flag the page hands the panel and the invite form. Those are
 * decisions members.tsx makes, and they are what this file is about.
 *
 * Kept apart from `members.test.tsx` because that file's caller is a fixed
 * org_admin and its invite form is mocked to nothing. Here the caller varies,
 * and People offers no invite form at all (Sada, 14 Oct 2026): inviting is
 * done from the Employee Card, and InviteTeam.test.tsx pins the form itself.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppError } from "@/platform/errors";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

const ALICE = "alice-id";
const MARK = "mark-id";
const RAVI = "ravi-id";

const h = vi.hoisted(() => ({
  callerRoles: ["org_admin"] as string[],
  setMemberRoles: vi.fn<(id: string, roles: string[]) => Promise<void>>(),
  setMemberModuleAdmins: vi.fn<(id: string, modules: string[]) => Promise<void>>(),
}));

/**
 * Ravi is deliberately NOT first. A save that went out under the first row's id
 * — or the signed-in person's — would hit Alice, and a fixture with Ravi on top
 * could not tell that apart from the right answer.
 */
const MEMBERS = [
  {
    id: ALICE,
    fullName: "Alice Admin",
    email: "alice.admin@acme.test",
    phone: null,
    joinedDate: "2019-01-01",
    isActive: true,
    managerId: null,
    departmentId: null,
    roles: ["org_admin"],
    moduleAdmin: [],
  },
  {
    id: MARK,
    fullName: "Mark Manager",
    email: "mark.manager@acme.test",
    phone: null,
    joinedDate: "2020-01-01",
    isActive: true,
    managerId: null,
    departmentId: null,
    roles: ["manager"],
    moduleAdmin: [],
  },
  {
    id: RAVI,
    fullName: "Ravi Employee",
    email: "ravi.emp@acme.test",
    phone: null,
    joinedDate: "2021-06-15",
    isActive: true,
    managerId: MARK,
    departmentId: null,
    roles: ["employee"],
    moduleAdmin: [],
  },
];

vi.mock("@/platform/auth", async () => {
  // The real role predicates, not stubs: which roles count as a Super Admin is
  // part of what is being proved, and a stub would only agree with itself.
  const { isAdmin, isSuperAdmin } = await import("@/platform/auth/session");
  const { ROLE_LABELS } = await import("@/platform/auth/contracts");
  return {
    ROLE_LABELS,
    isAdmin,
    isSuperAdmin,
    getCurrentUser: async () => ({
      id: "alice-id",
      email: "alice.admin@acme.test",
      fullName: "Alice Admin",
      organizationId: "org",
      organizationName: "Acme",
      roles: h.callerRoles,
    }),
    setMemberRoles: (id: string, roles: string[]) => h.setMemberRoles(id, roles),
    setMemberModuleAdmins: (id: string, modules: string[]) => h.setMemberModuleAdmins(id, modules),
    listMembers: async () => MEMBERS,
    listInvitations: async () => [],
    deactivateMember: vi.fn(),
    deactivationImpact: vi.fn(),
    reactivateMember: vi.fn(),
    revokeInvitation: vi.fn(),
    setJoinedDate: vi.fn(),
    setReportingLine: vi.fn(),
  };
});

// InviteTeam renders for real; only its network is replaced.
vi.mock("@/platform/auth/members", () => ({ inviteMember: vi.fn() }));
// D84: the module list the access panel offers. None here; members.access proves it.
vi.mock("@/platform/modules", () => ({
  getEnabledModules: async () => [{ key: "leave", name: "Leave Management" }],
}));
vi.mock("@/platform/organization", () => ({
  listDepartments: async () => [],
  setDepartment: vi.fn(),
}));

import { MembersPage } from "./members";

async function renderPeople(callerRoles: string[]) {
  h.callerRoles = callerRoles;
  const rendered = render(<MembersPage />);
  expect(await screen.findByText("In this workspace")).toBeInTheDocument();
  return rendered;
}

/** One person's row, ignoring the names that appear in every row's dropdowns. */
function rowFor(name: string): HTMLElement {
  const rows = screen.getAllByTestId("member-row").filter((row) => {
    const bare = row.cloneNode(true) as HTMLElement;
    bare.querySelectorAll("select").forEach((s) => s.remove());
    return (bare.textContent ?? "").includes(name);
  });
  if (rows.length !== 1) {
    throw new Error(`expected exactly one member row for "${name}", found ${rows.length}`);
  }
  return rows[0];
}

/** The invite form's Role dropdown, as the values a person could pick. */
beforeEach(() => {
  h.setMemberRoles.mockReset();
  h.setMemberRoles.mockResolvedValue(undefined);
  h.setMemberModuleAdmins.mockReset();
  h.setMemberModuleAdmins.mockResolvedValue(undefined);
});

describe("People — whose access can be changed", () => {
  it("offers no Change access on the signed-in person's own row, and offers it on everybody else's", async () => {
    // Nobody changes their own roles (D78). The database refuses it too; this
    // is so nobody is handed a switch that can only be refused.
    await renderPeople(["super_admin"]);

    expect(within(rowFor("Alice Admin")).queryByTestId("change-access")).toBeNull();
    expect(within(rowFor("Mark Manager")).getByTestId("change-access")).toBeInTheDocument();
    expect(within(rowFor("Ravi Employee")).getByTestId("change-access")).toBeInTheDocument();
  });

  it("saves the roles under the id of the person whose panel was opened", async () => {
    const user = userEvent.setup();
    await renderPeople(["org_admin"]);

    // Open Mark's first, then Ravi's: one panel at a time, and the save must
    // follow the panel that is open now.
    await user.click(within(rowFor("Mark Manager")).getByTestId("change-access"));
    await user.click(within(rowFor("Ravi Employee")).getByTestId("change-access"));
    expect(screen.getAllByTestId("access-editor")).toHaveLength(1);

    const panel = within(rowFor("Ravi Employee")).getByTestId("access-editor");
    await user.click(within(panel).getByTestId("role-manager"));
    await user.click(within(panel).getByTestId("access-save"));

    await waitFor(() => expect(h.setMemberRoles).toHaveBeenCalledTimes(1));
    expect(h.setMemberRoles).toHaveBeenCalledWith(RAVI, ["manager"]);
    // And the panel closes on success, with the page saying whose access moved.
    await waitFor(() => expect(screen.queryByTestId("access-editor")).toBeNull());
    expect(screen.getByText("Access for Ravi Employee updated.")).toBeInTheDocument();
  });

  it("D84: a Super Admin makes somebody Leave Admin, and their roles are not re-sent", async () => {
    const user = userEvent.setup();
    await renderPeople(["super_admin"]);
    await user.click(within(rowFor("Ravi Employee")).getByTestId("change-access"));
    const panel = within(rowFor("Ravi Employee")).getByTestId("access-editor");
    await user.click(within(panel).getByTestId("module-admin-leave"));
    await user.click(within(panel).getByTestId("access-save"));

    await waitFor(() => expect(h.setMemberModuleAdmins).toHaveBeenCalledWith(RAVI, ["leave"]));
    expect(h.setMemberRoles).not.toHaveBeenCalled();
  });

  it("shows a refusal inside the panel, and leaves the panel open", async () => {
    // The panel owns its refusals so they appear where the person is looking.
    // If People closed it first, the sentence would vanish with it and the
    // person would be left believing the change went through.
    const REFUSED = "Only a Super Admin can change an administrator's access.";
    h.setMemberRoles.mockRejectedValueOnce(new AppError("FORBIDDEN", REFUSED, 403));

    const user = userEvent.setup();
    await renderPeople(["org_admin"]);

    await user.click(within(rowFor("Ravi Employee")).getByTestId("change-access"));
    const panel = within(rowFor("Ravi Employee")).getByTestId("access-editor");
    await user.click(within(panel).getByTestId("role-supervisor"));
    await user.click(within(panel).getByTestId("access-save"));

    const err = await within(rowFor("Ravi Employee")).findByTestId("access-error");
    expect(err).toHaveTextContent(REFUSED);
    expect(within(rowFor("Ravi Employee")).getByTestId("access-editor")).toBeInTheDocument();
    // Not reported as a success, and not moved to the page-level banner.
    expect(screen.queryByText(/Access for Ravi Employee updated/)).toBeNull();
    expect(screen.queryByTestId("members-error")).toBeNull();
  });
});

describe("People — who may grant an administrator role", () => {
  it("offers a Super Admin the administrator roles, enabled, in the panel", async () => {
    const user = userEvent.setup();
    await renderPeople(["super_admin"]);

    await user.click(within(rowFor("Ravi Employee")).getByTestId("change-access"));
    const panel = within(rowFor("Ravi Employee")).getByTestId("access-editor");

    expect(within(panel).getByTestId("role-org_admin")).toBeEnabled();
    expect(within(panel).getByTestId("role-super_admin")).toBeEnabled();
  });

  it("does not offer an Admin who is not a Super Admin any administrator role in the panel", async () => {
    // Ravi holds no administrator role, so for this caller there is nothing in
    // the Administers group to show, locked or otherwise.
    const user = userEvent.setup();
    await renderPeople(["org_admin"]);

    await user.click(within(rowFor("Ravi Employee")).getByTestId("change-access"));
    const panel = within(rowFor("Ravi Employee")).getByTestId("access-editor");

    expect(within(panel).queryByTestId("role-org_admin")).toBeNull();
    expect(within(panel).queryByTestId("role-super_admin")).toBeNull();
    expect(within(panel).queryByTestId("role-hr_admin")).toBeNull();
    // The approver roles are still there — the panel is narrowed, not empty.
    expect(within(panel).getByTestId("role-manager")).toBeEnabled();
  });

  it("offers nobody a way to invite from People: that is the Employee Card's", async () => {
    // Sada, 14 Oct 2026: one way in, from the person's record, so every module
    // sees the same person. People keeps who is waiting to join.
    for (const roles of [["org_admin"], ["super_admin"]]) {
      const { unmount } = await renderPeople(roles);
      expect(screen.queryByText("Invite somebody")).toBeNull();
      expect(screen.queryByRole("button", { name: /Send invitation/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /Import them/ })).toBeNull();
      unmount();
    }
  });
});

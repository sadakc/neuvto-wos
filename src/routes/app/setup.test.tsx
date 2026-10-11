// @vitest-environment happy-dom

/**
 * D78 — the set-up wizard's "Your team" step, and who it lets you invite.
 *
 * An invitation is a role grant that arrives later, so only a Super Admin may
 * invite somebody as an administrator. `InviteTeam.test.tsx` proves the form
 * narrows its list when told to. What it cannot prove is that this screen
 * tells it — and the wizard is where a newly provisioned administrator invites
 * their first colleagues, so it is the likeliest place for the wrong flag to
 * hand an Admin an "Administrator" option the database will only refuse.
 *
 * The real InviteTeam renders; only its network is replaced. Everything the
 * other steps reach for is stubbed to nothing, because they are not on screen
 * at the step under test.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: React.ReactNode }) => children,
  useNavigate: () => vi.fn(),
}));

const h = vi.hoisted(() => ({ callerRoles: ["org_admin"] as string[] }));

vi.mock("@/platform/auth", async () => {
  // Real predicates: which roles count as a Super Admin is part of the claim.
  const { isAdmin, isSuperAdmin } = await import("@/platform/auth/session");
  return {
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
    listMembers: async () => [],
    listInvitations: async () => [],
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
}));
vi.mock("@/platform/modules", () => ({ OrgModules: () => null }));
vi.mock("@/platform/calendar/WorkingCalendar", () => ({ WorkingCalendar: () => null }));
vi.mock("@/platform/organization/CompanyIdentity", () => ({ CompanyIdentity: () => null }));
vi.mock("@/platform/organization", () => ({
  companyName: () => "Acme",
  completeOnboarding: vi.fn(),
  getOrganization: async () => null,
  listDepartments: async () => [],
}));
vi.mock("@/platform/auth/members", () => ({ inviteMember: vi.fn() }));

import { Route } from "./setup";

const SetupWizard = (Route as unknown as { component: () => React.ReactElement }).component;

async function openTeamStep(callerRoles: string[]) {
  h.callerRoles = callerRoles;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  const user = userEvent.setup();
  render(<SetupWizard />);
  await user.click(await screen.findByRole("button", { name: /^Your team/ }));
  await screen.findByLabelText("Role");
}

function inviteRoleValues(): string[] {
  const select = screen.getByLabelText("Role") as HTMLSelectElement;
  return [...select.options].map((o) => o.value);
}

describe("Set-up wizard — Your team", () => {
  it("does not let an Admin who is not a Super Admin invite an Administrator", async () => {
    await openTeamStep(["org_admin"]);

    const values = inviteRoleValues();
    expect(values).not.toContain("org_admin");
    expect(values).not.toContain("super_admin");
    expect(values).not.toContain("hr_admin");
    expect(values).toContain("employee");
  });

  it("lets a Super Admin invite an Administrator", async () => {
    await openTeamStep(["super_admin"]);

    expect(inviteRoleValues()).toContain("org_admin");
  });
});

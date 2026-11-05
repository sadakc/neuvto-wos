// @vitest-environment happy-dom

/**
 * The set-up wizard invites nobody (Sada, 14 Oct 2026, D110). There is one
 * way into the company: a person's record, Employee Card › Add Employee. The
 * wizard's old "Your team" step was a second, and so was People's form; both
 * are gone, and the database refuses an invitation made any other way.
 *
 * Everything the steps reach for is stubbed to nothing; what is under test is
 * which steps there are and what the last one says.
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

import { Route } from "./setup";

const SetupWizard = (Route as unknown as { component: () => React.ReactElement }).component;

function openWizard() {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  render(<SetupWizard />);
}

describe("Set-up wizard — one way in", () => {
  it("has no team step and no invite form", async () => {
    openWizard();
    expect(await screen.findByRole("button", { name: /^Modules/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Your team/ })).toBeNull();
    expect(screen.queryByLabelText("Role")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send invitation/ })).toBeNull();
  });

  it("says, at the end, where people are added", async () => {
    openWizard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Done/ }));
    expect(await screen.findByTestId("setup-add-people")).toHaveTextContent(
      "start their record and invite them from it",
    );
  });
});

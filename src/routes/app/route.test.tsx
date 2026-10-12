// @vitest-environment happy-dom
/**
 * The /app shell as a person of each role meets it.
 *
 * model.test.ts proves what buildShell returns. This proves the shell route
 * hands it the signed-in person and that the frame draws the result: an
 * employee standing on a Leave page has no Organisation entry in the rail and
 * no Company menu in the tab bar (absent, not disabled), and an administrator
 * on the same page has both.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import type { ComponentType } from "react";
import type { AppRole, CurrentUser } from "@/platform/auth";
import type { ModuleDefinition } from "@/platform/modules";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Outlet: () => <p>the screen</p>,
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: "/app/leave" }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { search: {} } }),
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children?: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a href={to + (search ? `?${new URLSearchParams(search)}` : "")} {...rest}>
      {children}
    </a>
  ),
}));

const getCurrentUser = vi.fn<() => Promise<CurrentUser | null>>();

vi.mock("@/platform/auth", async () => {
  // Real role helpers: the gate under test is theirs. `session` imports the
  // Supabase client, a lazy Proxy that constructs nothing until queried.
  const { isAdmin, isModuleAdmin, canApprove } = await import("@/platform/auth/session");
  return {
    isAdmin,
    isModuleAdmin,
    canApprove,
    getCurrentUser: () => getCurrentUser(),
    signOut: vi.fn(),
  };
});

vi.mock("@/platform/organization", () => ({
  companyName: () => "Acme",
  getLogoUrl: async () => null,
  getOrganization: async () => null,
  onIdentityChange: () => () => {},
}));

vi.mock("@/components/shared/theme-toggle", () => ({ ThemeToggle: () => null }));

const leave: ModuleDefinition = {
  key: "leave",
  name: "Leave Management",
  version: "1",
  navigation: () => [{ label: "My Leave", to: "/app/leave" }],
  routes: [],
  reports: () => [],
  adminSections: () => [],
  approvalEntityTypes: ["leave_request"],
  eventKeys: [],
  settingsSchema: z.object({}),
  ownedTables: [],
};

vi.mock("@/platform/modules", () => ({ getEnabledModules: async () => [leave] }));

const { Route } = await import("./route");
const AppShell = (Route as unknown as { component: ComponentType }).component;

const user = (roles: AppRole[]): CurrentUser => ({
  id: "u",
  email: "u@acme.test",
  fullName: "U",
  organizationId: "o",
  organizationName: "Acme",
  roles,
});

// happy-dom has no layout; at 0px the tab bar is a phone picker. 1200px is a
// desktop, where Company is a menu in the row.
let original: PropertyDescriptor | undefined;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1200,
  });
});
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});

/** Waits for the shell, then for Leave to arrive from getEnabledModules. */
async function shellFor(roles: AppRole[]) {
  getCurrentUser.mockResolvedValue(user(roles));
  render(<AppShell />);
  expect(await screen.findByTestId("rail-leave")).toHaveAttribute("aria-current", "page");
}

describe("the shell, per role, on a Leave page", () => {
  it("an employee has no Organisation rail entry and no Company menu", async () => {
    await shellFor(["employee"]);
    expect(screen.getByTestId("rail-home")).toBeInTheDocument();
    expect(screen.queryByTestId("rail-organisation")).toBeNull();
    expect(screen.queryByText("Organisation")).toBeNull();
    expect(screen.queryByTestId("tab-company")).toBeNull();
  });

  it("an org_admin has both", async () => {
    await shellFor(["employee", "org_admin"]);
    expect(screen.getByTestId("rail-organisation")).toHaveAttribute("href", "/app/members");
    expect(screen.getByTestId("tab-company")).toBeInTheDocument();
  });
});

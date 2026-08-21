/**
 * What each scope contains, and which one an address belongs to.
 *
 * The second question is the one with a trap in it. The organisation scope owns
 * `configurations`, and every module owns `configurations/<its key>` — so `/app/configurations/payroll`
 * is claimed by two scopes at once, and a first-match rule hands it to whichever
 * happens to be listed first. The organisation always is. The symptom would be
 * opening payroll's own settings and watching the switcher and the sidebar
 * insist you are looking at the organisation's.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { moduleScope, organisationScope, scopeForPath, ORGANISATION_SCOPE } from "./scopes";
import type { ModuleDefinition } from "./contract";
import type { CurrentUser } from "@/platform/auth";

const user = (roles: string[]) =>
  ({
    id: "u1",
    email: "someone@acme.test",
    roles,
    organizationId: "o1",
    organizationName: "Acme",
  }) as unknown as CurrentUser;

const admin = user(["org_admin"]);
const employee = user(["employee"]);

const noop = () => null;

const moduleWith = (over: Partial<ModuleDefinition>): ModuleDefinition =>
  ({
    key: "payroll",
    name: "Payroll",
    version: "1.0.0",
    navigation: () => [],
    routes: [],
    approvalEntityTypes: [],
    eventKeys: [],
    settingsSchema: z.object({}),
    ownedTables: [],
    ...over,
  }) as ModuleDefinition;

describe("the organisation scope", () => {
  it("gives an employee one destination", () => {
    // The whole point of scoping, measured. Before it, this person was shown
    // the workspace's full list and refused most of it.
    expect(organisationScope(employee).items.map((i) => i.label)).toEqual(["Dashboard"]);
  });

  it("gives a manager the approvals queue without making them an administrator", () => {
    const labels = organisationScope(user(["manager"])).items.map((i) => i.label);
    expect(labels).toContain("Approvals");
    expect(labels).not.toContain("Configurations");
    expect(labels).not.toContain("People");
  });

  it("gives an administrator the workspace-wide screens", () => {
    const labels = organisationScope(admin).items.map((i) => i.label);
    expect(labels).toEqual([
      "Dashboard",
      "Approvals",
      "People",
      "Reports",
      "Approval rules",
      "Configurations",
    ]);
  });
});

describe("a module's scope", () => {
  const payroll = moduleWith({
    navigation: () => [
      { label: "Pay runs", to: "/app/payroll", roles: ["org_admin", "hr_admin"] },
      { label: "Payslips", to: "/app/payroll/payslips" },
    ],
    routes: [
      { path: "payroll", component: noop as never },
      { path: "payroll/payslips", component: noop as never },
    ],
    adminSections: () => [{ id: "x", title: "Something", component: noop as never }],
  });

  it("shows an employee only what they may open", () => {
    // Not "shows it and refuses them". Payroll, for an employee, is one screen.
    expect(moduleScope(payroll, employee).items.map((i) => i.label)).toEqual(["Payslips"]);
  });

  it("gives an administrator the module's own configurations page", () => {
    const items = moduleScope(payroll, admin).items;
    expect(items.map((i) => i.label)).toEqual(["Pay runs", "Payslips", "Configurations"]);
    expect(items.at(-1)?.to).toBe("/app/configurations/payroll");
  });

  it("offers no settings link for a module with nothing to configure", () => {
    // A link to a page that would render an empty state is worse than no link:
    // it advertises configuration that does not exist.
    const bare = moduleWith({
      key: "learning",
      name: "Learning",
      navigation: () => [{ label: "Courses", to: "/app/learning" }],
      routes: [{ path: "learning", component: noop as never }],
    });
    expect(moduleScope(bare, admin).items.map((i) => i.label)).toEqual(["Courses"]);
  });

  it("claims its own routes and its own configurations page, and nothing else", () => {
    expect(moduleScope(payroll, admin).owns).toEqual([
      "payroll",
      "payroll/payslips",
      "configurations/payroll",
    ]);
  });
});

describe("which scope an address belongs to", () => {
  const leave = moduleWith({
    key: "leave",
    name: "Leave Management",
    navigation: () => [{ label: "My leave", to: "/app/leave" }],
    routes: [
      { path: "leave", component: noop as never },
      { path: "leave/apply", component: noop as never },
    ],
    adminSections: () => [{ id: "types", title: "Leave types", component: noop as never }],
  });

  const payroll = moduleWith({
    navigation: () => [{ label: "Pay runs", to: "/app/payroll" }],
    routes: [{ path: "payroll", component: noop as never }],
    adminSections: () => [{ id: "sc", title: "Salary components", component: noop as never }],
  });

  const scopes = [organisationScope(admin), moduleScope(leave, admin), moduleScope(payroll, admin)];

  it("puts the dashboard in the organisation", () => {
    expect(scopeForPath(scopes, "/app")?.key).toBe(ORGANISATION_SCOPE);
    expect(scopeForPath(scopes, "/app/")?.key).toBe(ORGANISATION_SCOPE);
  });

  it("does not let the dashboard's empty path swallow everything else", () => {
    // `owns: [""]` prefix-matches every address in the workspace if it is
    // treated as a prefix rather than as an exact match.
    expect(scopeForPath(scopes, "/app/members")?.key).toBe(ORGANISATION_SCOPE);
    expect(scopeForPath(scopes, "/app/payroll")?.key).toBe("payroll");
  });

  it("keeps a module's own pages in the module", () => {
    expect(scopeForPath(scopes, "/app/leave")?.key).toBe("leave");
    expect(scopeForPath(scopes, "/app/leave/apply")?.key).toBe("leave");
  });

  it("gives the organisation its own configurations page", () => {
    expect(scopeForPath(scopes, "/app/configurations")?.key).toBe(ORGANISATION_SCOPE);
  });

  it("gives a module's configurations page to the MODULE, not the organisation", () => {
    // Both scopes claim this address: the organisation owns `configurations`, payroll
    // owns `configurations/payroll`. Longest match is what decides it, and without
    // that rule the sidebar would show the organisation's destinations while
    // the page showed payroll's configuration.
    expect(scopeForPath(scopes, "/app/configurations/payroll")?.key).toBe("payroll");
    expect(scopeForPath(scopes, "/app/configurations/leave")?.key).toBe("leave");
  });

  it("claims nothing it does not own", () => {
    // A module switched off mid-session, or a mistyped address. The shell falls
    // back to the organisation; the page renders its own not-found.
    expect(scopeForPath(scopes, "/app/attendance/roster")).toBeUndefined();
  });
});

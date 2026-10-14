/**
 * What each role is offered, as a matrix (DESIGN_SYSTEM §7, EMPLOYEE_MASTER §5).
 *
 * Replaces app-nav.test.ts, whose real subject survives: an administrator on a
 * phone once had no route to Approval rules or Settings at all, because the
 * old bar sliced its list at five and deleted the rest. A destination missing
 * for a role that may use it, or present for one that may not, is the bug
 * this file exists for.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppRole, CurrentUser } from "@/platform/auth";
import type { ModuleDefinition } from "@/platform/modules";
import { fitTabs } from "./fit";
import { buildShell, groupBySection, locate, type ShellModule } from "./model";

const user = (roles: AppRole[]): CurrentUser => ({
  id: "u",
  email: "u@acme.test",
  fullName: "U",
  organizationId: "o",
  organizationName: "Acme",
  roles,
});

const leaveLike: ModuleDefinition = {
  key: "leave",
  name: "Leave Management",
  shortName: "Leave",
  section: "Time",
  version: "1",
  navigation: () => [
    { label: "Apply Leave", to: "/app/leave/apply" },
    { label: "My Leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
  ],
  routes: [],
  reports: () => [],
  adminSections: () => [],
  approvalEntityTypes: ["leave_request"],
  eventKeys: [],
  settingsSchema: z.object({}),
  ownedTables: [],
};

const labels = (shell: ShellModule[], key: string) =>
  shell.find((m) => m.key === key)?.tabs.map((t) => t.label) ?? [];

const ROLES: Array<[string, AppRole[]]> = [
  ["employee", ["employee"]],
  ["manager", ["employee", "manager"]],
  ["supervisor", ["employee", "supervisor"]],
  ["coordinator", ["employee", "coordinator"]],
  ["hr admin", ["employee", "hr_admin"]],
  ["org admin", ["employee", "org_admin"]],
];

describe("what each role is offered", () => {
  it.each(ROLES)("%s", (name, roles) => {
    const shell = buildShell(user(roles), [leaveLike]);
    const admin = roles.includes("org_admin") || roles.includes("hr_admin");
    const approver =
      admin || roles.some((r) => ["manager", "supervisor", "coordinator"].includes(r));

    // Everyone: Home and the module's own tabs.
    expect(labels(shell, "home")).toContain("Dashboard");
    expect(labels(shell, "leave")).toEqual(
      expect.arrayContaining(["Apply Leave", "My Leave", "Calendar"]),
    );

    // Approvals for anyone who can approve, including the Supervisor and
    // Coordinator the old nav forgot (it checked manager and admins only).
    expect(labels(shell, "home").includes("Approvals"), `${name}: home Approvals`).toBe(approver);
    expect(labels(shell, "leave").includes("Approvals"), `${name}: leave Approvals`).toBe(approver);

    // Company tabs and the Organisation entry for administrators only. Not
    // disabled for everyone else: absent. Approval rules and Reports belong
    // to the module whose requests they are (Sada, 14 Oct 2026), not to
    // Organisation.
    expect(labels(shell, "leave").includes("Configuration"), `${name}: Configuration`).toBe(admin);
    expect(labels(shell, "leave").includes("Reports"), `${name}: Reports`).toBe(admin);
    expect(labels(shell, "leave").includes("Approval rules"), `${name}: Approval rules`).toBe(
      admin,
    );
    expect(
      shell.some((m) => m.key === "organisation"),
      `${name}: Organisation`,
    ).toBe(admin);
    if (admin) {
      expect(labels(shell, "organisation")).toEqual(["People", "Settings"]);
    }

    // The count behind "N tabs hidden for this role" matches what was left out.
    const leave = shell.find((m) => m.key === "leave")!;
    expect(leave.hiddenForRole, name).toBe((approver ? 0 : 1) + (admin ? 0 : 3));
  });

  it("an administrator reaches every destination at every width", () => {
    // The original regression, at every bar width from a 320px phone up:
    // every tab is in the row, behind More, or behind Company. Never nowhere.
    const shell = buildShell(user(["employee", "org_admin"]), [leaveLike]);
    for (const m of shell) {
      const row = m.tabs.filter((t) => t.group !== "company");
      const company = m.tabs.filter((t) => t.group === "company");
      for (let bar = 320; bar <= 1600; bar += 20) {
        const fit = fitTabs({
          barWidth: bar,
          tabWidths: row.map((t) => t.label.length * 8 + 24),
          activeIndex: 0,
          fixedWidth: company.length ? 110 : 0,
          moreWidth: 82,
          roleNoteWidth: null,
          badges: row.map(() => 0),
        });
        // Pick mode lists every tab in its panel; row mode splits them.
        const reachable =
          fit.mode === "pick"
            ? m.tabs.length
            : fit.visible.filter(Boolean).length + fit.moreCount + company.length;
        expect(reachable, `${m.key} at ${bar}px`).toBe(m.tabs.length);
      }
    }
  });

  it("a module with no approvals, reports or configuration adds none", () => {
    const bare = {
      ...leaveLike,
      key: "bare",
      approvalEntityTypes: [],
      reports: undefined,
      adminSections: undefined,
    };
    const shell = buildShell(user(["employee", "org_admin"]), [bare]);
    expect(labels(shell, "bare")).toEqual(["Apply Leave", "My Leave", "Calendar"]);
  });

  it("an item restricted to roles the person lacks is left out and counted", () => {
    const m = {
      ...leaveLike,
      key: "restricted",
      navigation: () => [
        { label: "Mine", to: "/app/r" },
        {
          label: "Admin only",
          to: "/app/r/admin",
          roles: ["org_admin"] as AppRole[],
          group: "company" as const,
        },
      ],
      approvalEntityTypes: [],
      reports: undefined,
      adminSections: undefined,
    };
    const emp = buildShell(user(["employee"]), [m]).find((x) => x.key === "restricted")!;
    expect(emp.tabs.map((t) => t.label)).toEqual(["Mine"]);
    expect(emp.hiddenForRole).toBe(1);
  });
});

describe("a module's tabs placed under Organisation (Sada, 14 Oct 2026)", () => {
  const withCompanyViews: ModuleDefinition = {
    ...leaveLike,
    key: "employee",
    name: "Employee Card",
    section: "People",
    navigation: () => [
      { label: "My Card", to: "/app/employee" },
      { label: "Org Chart", to: "/app/employee/my-org-chart" },
      {
        label: "Directory",
        to: "/app/employee/directory",
        placement: "organisation",
        moduleAdmin: true,
      },
      { label: "Org Chart", to: "/app/employee/org-chart", placement: "organisation" },
    ],
    approvalEntityTypes: [],
    reports: undefined,
    adminSections: undefined,
  };

  it("gives everybody Organisation with the whole org chart, and no more", () => {
    const shell = buildShell(user(["employee"]), [withCompanyViews]);
    expect(labels(shell, "organisation")).toEqual(["Org Chart"]);
    expect(labels(shell, "employee")).toEqual(["My Card", "Org Chart"]);
    // The directory, People and Settings.
    expect(shell.find((m) => m.key === "organisation")!.hiddenForRole).toBe(3);
  });

  it("gives an administrator the directory there too, between People and Settings", () => {
    const shell = buildShell(user(["employee", "hr_admin"]), [withCompanyViews]);
    expect(labels(shell, "organisation")).toEqual(["People", "Directory", "Org Chart", "Settings"]);
    expect(labels(shell, "employee")).not.toContain("Directory");
  });

  it("lights Organisation for the company's chart and the module for the person's own", () => {
    const shell = buildShell(user(["employee", "hr_admin"]), [withCompanyViews]);
    expect(locate(shell, { pathname: "/app/employee/org-chart" }).module.key).toBe("organisation");
    expect(locate(shell, { pathname: "/app/employee/directory/person" }).module.key).toBe(
      "organisation",
    );
    expect(locate(shell, { pathname: "/app/employee/my-org-chart" }).module.key).toBe("employee");
  });
});

describe("an admin for each module (D84)", () => {
  const employeeLike: ModuleDefinition = {
    ...leaveLike,
    key: "employee",
    name: "Employee Master",
    section: "People",
    navigation: () => [
      { label: "My Card", to: "/app/employee" },
      { label: "Add Employee", to: "/app/employee/add", group: "company", moduleAdmin: true },
    ],
    approvalEntityTypes: [],
    reports: undefined,
    adminSections: undefined,
  };
  const granted = (moduleAdmin: string[]): CurrentUser => ({
    ...user(["employee"]),
    moduleAdmin,
  });

  it("gives a Leave Admin Leave's company tabs and nothing of another module's or the company's", () => {
    const shell = buildShell(granted(["leave"]), [leaveLike, employeeLike]);
    expect(labels(shell, "leave")).toEqual(expect.arrayContaining(["Reports", "Configuration"]));
    expect(labels(shell, "employee")).toEqual(["My Card"]);
    expect(shell.find((m) => m.key === "organisation")).toBeUndefined();
  });

  it("gives an Employee Admin the employee module's admin tabs and not Leave's", () => {
    const shell = buildShell(granted(["employee"]), [leaveLike, employeeLike]);
    expect(labels(shell, "employee")).toEqual(["My Card", "Add Employee"]);
    expect(labels(shell, "leave")).not.toContain("Configuration");
  });

  it("gives a company-wide Admin both, with no grant", () => {
    const shell = buildShell(user(["employee", "hr_admin"]), [leaveLike, employeeLike]);
    expect(labels(shell, "employee")).toContain("Add Employee");
    expect(labels(shell, "leave")).toContain("Configuration");
  });
});

describe("locate", () => {
  const shell = buildShell(user(["employee", "org_admin"]), [leaveLike]);

  it("picks the longest matching tab, not the first", () => {
    expect(locate(shell, { pathname: "/app/leave/apply" }).tab?.label).toBe("Apply Leave");
    expect(locate(shell, { pathname: "/app/leave" }).tab?.label).toBe("My Leave");
  });

  it("uses ?m= to say whose view of a shared screen this is", () => {
    const { module, tab } = locate(shell, { pathname: "/app/approvals", module: "leave" });
    expect(module.key).toBe("leave");
    expect(tab?.id).toBe("approvals");
  });

  it("without ?m= a shared screen belongs to the platform", () => {
    expect(locate(shell, { pathname: "/app/approvals" }).module.key).toBe("home");
    expect(locate(shell, { pathname: "/app/settings" }).module.key).toBe("organisation");
  });

  it("opens Approval rules as the module's own", () => {
    const { module, tab } = locate(shell, { pathname: "/app/approval-rules", module: "leave" });
    expect(module.key).toBe("leave");
    expect(tab?.label).toBe("Approval rules");
  });

  it("falls back to Home rather than to nothing", () => {
    expect(locate(shell, { pathname: "/app/nowhere" }).module.key).toBe("home");
    expect(locate(shell, { pathname: "/app" }).tab?.label).toBe("Dashboard");
  });

  it("ignores a ?m= naming a module that is not here", () => {
    expect(locate(shell, { pathname: "/app/leave", module: "payroll" }).module.key).toBe("leave");
  });
});

describe("groupBySection", () => {
  it("never emits a section twice, whatever the registry order", () => {
    const mod = (key: string, section: ShellModule["section"]): ShellModule => ({
      key,
      name: key,
      short: key,
      section,
      tabs: [],
      hiddenForRole: 0,
    });
    const groups = groupBySection([
      mod("leave", "Time"),
      mod("employee", "People"),
      mod("attendance", "Time"),
      mod("payroll", "Money"),
      mod("training", "People"),
    ]);
    expect(groups.map((g) => g.section)).toEqual(["Time", "People", "Money"]);
    expect(groups[0].modules.map((m) => m.key)).toEqual(["leave", "attendance"]);
  });
});

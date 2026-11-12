/**
 * Doc 11, the pure rules: which section is a module's home, how the sheet
 * groups a module's sections for each role, and what the home's tiles are.
 * One shell model feeds the tabs, the tiles and the sheet, so a section a role
 * may not open is absent from all three.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AppRole, CurrentUser } from "@/platform/auth";
import type { ModuleDefinition } from "@/platform/modules";

vi.mock("@/platform/approvals", () => ({ listApprovalQueue: vi.fn(async () => []) }));

import { buildShell } from "./model";
import { PHONE_WIDTH, homeTiles, isPhoneWidth, moduleHome, sectionGroups } from "./phone";

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
  home: "/app/leave",
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

const leaveFor = (roles: AppRole[]) =>
  buildShell(user(roles), [leaveLike]).find((m) => m.key === "leave")!;

describe("the phone breakpoint", () => {
  it("is under 600px, and an unmeasured stage is not a phone", () => {
    expect(PHONE_WIDTH).toBe(600);
    expect(isPhoneWidth(599)).toBe(true);
    expect(isPhoneWidth(600)).toBe(false);
    expect(isPhoneWidth(0)).toBe(false);
  });
});

describe("a module's home", () => {
  it("is the section the module names", () => {
    expect(moduleHome(leaveFor(["employee"]))?.label).toBe("My Leave");
  });

  it("is the first section when the module names none", () => {
    expect(
      moduleHome(buildShell(user(["employee"]), [{ ...leaveLike, home: undefined }])[1])?.label,
    ).toBe("Apply Leave");
  });
});

describe("the sheet's groups", () => {
  it("for an employee: their own sections, and no empty heading left behind", () => {
    const groups = sectionGroups(leaveFor(["employee"]));
    expect(groups.map((g) => g.heading)).toEqual(["For you"]);
    expect(groups[0].tabs.map((t) => t.label)).toEqual(["Apply Leave", "My Leave", "Calendar"]);
  });

  it("for a manager: and their team's", () => {
    expect(sectionGroups(leaveFor(["employee", "manager"])).map((g) => g.heading)).toEqual([
      "For you",
      "For your team",
    ]);
  });

  it("for an admin: and the company's", () => {
    const groups = sectionGroups(leaveFor(["employee", "org_admin"]));
    expect(groups.map((g) => g.heading)).toEqual(["For you", "For your team", "Company"]);
    expect(groups[2].tabs.map((t) => t.label)).toEqual([
      "Approval rules",
      "Reports",
      "Configuration",
    ]);
  });
});

describe("the home's tiles", () => {
  it("are every other section, not the home itself, with Company folded into one", () => {
    const admin = homeTiles(leaveFor(["employee", "org_admin"]));
    expect(admin.tiles.map((t) => t.label)).toEqual(["Apply Leave", "Calendar", "Leave approvals"]);
    expect(admin.company).toBe(3);
  });

  it("have no Company tile for somebody with no company sections", () => {
    const employee = homeTiles(leaveFor(["employee"]));
    expect(employee.tiles.map((t) => t.label)).toEqual(["Apply Leave", "Calendar"]);
    expect(employee.company).toBe(0);
  });
});

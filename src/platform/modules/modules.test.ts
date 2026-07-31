/**
 * The module contract, exercised by a module that does not exist.
 *
 * `noticeboard` is invented here and has nothing to do with Leave. That is the
 * whole point — the same trick as the `harness_probe` entity type that proved
 * the Approval Engine knows nothing about leave. A contract only testable
 * through the module it was written for is not a contract, it is that module's
 * internals with extra steps.
 *
 * If Leave were deleted tomorrow, every test in this file would still pass.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const enabledKeys = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: enabledKeys.current.map((module_key) => ({ module_key, enabled: true })),
            error: null,
          }),
      }),
    }),
  },
}));

const {
  installModules,
  allModules,
  moduleByKey,
  getEnabledModules,
  getModuleNavigation,
  getDashboardCards,
  resolveModuleRoute,
} = await import("./registry");

import type { ModuleDefinition } from "./contract";
import type { CurrentUser } from "@/platform/auth";

function user(roles: CurrentUser["roles"]): CurrentUser {
  return {
    id: "u1",
    email: "a@b.test",
    fullName: "A",
    organizationId: "o1",
    organizationName: "Org",
    roles,
  };
}

function noticeboard(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    key: "noticeboard",
    name: "Noticeboard",
    version: "1.0.0",
    navigation: (u) => [
      { label: "Notices", to: "/app/noticeboard" },
      { label: "Post a notice", to: "/app/noticeboard/new", roles: ["hr_admin", "org_admin"] },
      ...(u ? [] : []),
    ],
    routes: [
      { path: "noticeboard", component: () => null },
      { path: "noticeboard/new", component: () => null },
    ],
    dashboardCards: (u) => [
      { id: "notices-summary", component: () => null, order: 10 },
      ...(u?.roles.includes("hr_admin")
        ? [{ id: "notices-draft", component: () => null, order: 20 }]
        : []),
    ],
    approvalEntityTypes: ["notice"],
    eventKeys: ["notice.published"],
    settingsSchema: z.object({ pinnedLimit: z.number().int().min(1).max(10) }),
    ownedTables: ["notice_posts"],
    ...overrides,
  };
}

beforeEach(() => {
  enabledKeys.current = [];
  installModules([]);
});

describe("installing modules", () => {
  it("accepts a well-formed manifest from a module the platform has never heard of", () => {
    installModules([noticeboard()]);
    expect(allModules()).toHaveLength(1);
    expect(moduleByKey("noticeboard")?.name).toBe("Noticeboard");
  });

  it("rejects a malformed manifest at startup rather than as an empty sidebar later", () => {
    expect(() => installModules([noticeboard({ key: "Not Snake Case" })])).toThrow(
      /invalid manifest/,
    );
  });

  it("rejects two modules claiming the same key", () => {
    expect(() => installModules([noticeboard(), noticeboard()])).toThrow(/declare the key/);
  });

  it("rejects two modules claiming the same route", () => {
    const other = noticeboard({
      key: "bulletin",
      routes: [{ path: "noticeboard", component: () => null }],
      approvalEntityTypes: [],
    });
    expect(() => installModules([noticeboard(), other])).toThrow(/claimed by more than one module/);
  });

  it("rejects two modules claiming the same approval entity type", () => {
    // The Approval Engine is entity-agnostic and would happily let both through,
    // which is exactly why this has to be caught here.
    const other = noticeboard({
      key: "bulletin",
      routes: [{ path: "bulletin", component: () => null }],
    });
    expect(() => installModules([noticeboard(), other])).toThrow(/entity type "notice"/);
  });
});

describe("what an organisation actually has", () => {
  it("gives nothing when the organisation has not switched the module on", async () => {
    installModules([noticeboard()]);
    enabledKeys.current = [];
    expect(await getEnabledModules()).toHaveLength(0);
  });

  it("gives the module once it is switched on", async () => {
    installModules([noticeboard()]);
    enabledKeys.current = ["noticeboard"];
    expect(await getEnabledModules()).toHaveLength(1);
  });

  it("ignores a key the build does not contain, rather than failing", async () => {
    // A customer with a retired module still enabled must not break the shell.
    installModules([noticeboard()]);
    enabledKeys.current = ["noticeboard", "module_that_no_longer_ships"];
    expect(await getEnabledModules()).toHaveLength(1);
  });
});

describe("navigation", () => {
  beforeEach(() => {
    installModules([noticeboard()]);
    enabledKeys.current = ["noticeboard"];
  });

  it("contributes the module's items without the shell knowing what they are", async () => {
    const items = await getModuleNavigation(user(["employee"]));
    expect(items.map((i) => i.label)).toEqual(["Notices"]);
  });

  it("includes role-restricted items for someone holding the role", async () => {
    const items = await getModuleNavigation(user(["hr_admin"]));
    expect(items.map((i) => i.label)).toEqual(["Notices", "Post a notice"]);
  });

  it("contributes nothing when the module is off", async () => {
    enabledKeys.current = [];
    expect(await getModuleNavigation(user(["org_admin"]))).toEqual([]);
  });
});

describe("dashboard cards", () => {
  beforeEach(() => {
    installModules([noticeboard()]);
    enabledKeys.current = ["noticeboard"];
  });

  it("contributes cards without the dashboard knowing what they are", async () => {
    const cards = await getDashboardCards(user(["employee"]));
    expect(cards.map((c) => c.id)).toEqual(["notices-summary"]);
    expect(cards[0].moduleKey).toBe("noticeboard");
  });

  it("gives a role-restricted card only to someone holding the role", async () => {
    const cards = await getDashboardCards(user(["hr_admin"]));
    expect(cards.map((c) => c.id)).toEqual(["notices-summary", "notices-draft"]);
  });

  it("contributes nothing when the module is switched off", async () => {
    enabledKeys.current = [];
    expect(await getDashboardCards(user(["hr_admin"]))).toEqual([]);
  });

  it("returns nothing at all when no module is installed", async () => {
    // The dashboard has to work with zero modules — which is exactly the state
    // the module-removal check puts the application in.
    installModules([]);
    expect(await getDashboardCards(user(["employee"]))).toEqual([]);
  });

  it("tolerates a module that contributes no cards", async () => {
    installModules([noticeboard({ dashboardCards: undefined })]);
    expect(await getDashboardCards(user(["employee"]))).toEqual([]);
  });

  it("orders cards by their declared order, not by module order", async () => {
    const late = noticeboard({
      key: "bulletin",
      routes: [{ path: "bulletin", component: () => null }],
      approvalEntityTypes: [],
      dashboardCards: () => [{ id: "bulletin-card", component: () => null, order: 5 }],
    });
    installModules([noticeboard(), late]);
    enabledKeys.current = ["noticeboard", "bulletin"];
    const cards = await getDashboardCards(user(["employee"]));
    expect(cards.map((c) => c.id)).toEqual(["bulletin-card", "notices-summary"]);
  });
});

describe("routing", () => {
  beforeEach(() => {
    installModules([noticeboard()]);
    enabledKeys.current = ["noticeboard"];
  });

  it("resolves a path to the module that serves it", async () => {
    const hit = await resolveModuleRoute("noticeboard/new");
    expect(hit?.module.key).toBe("noticeboard");
  });

  it("tolerates surrounding slashes", async () => {
    expect(await resolveModuleRoute("/noticeboard/")).toBeDefined();
  });

  it("resolves nothing for a path no module claims", async () => {
    expect(await resolveModuleRoute("payroll/run")).toBeUndefined();
  });

  it("resolves nothing once the module is switched off", async () => {
    // A disabled module's pages must stop existing, not merely stop being linked.
    enabledKeys.current = [];
    expect(await resolveModuleRoute("noticeboard")).toBeUndefined();
  });
});

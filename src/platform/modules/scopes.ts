/**
 * Platform · Workspace scopes
 *
 * One workspace, several worlds. The shell used to show every destination from
 * every module in a single list — Dashboard, Apply, My leave, Calendar, Pay
 * runs, Payslips, Approvals, People, Reports, Approval rules, Settings — and
 * then configuration for all of them on one scrolling page. Sada's words for
 * it: every module should have its own settings, and what the whole
 * organisation shares should stay shared.
 *
 * So the shell resolves to a SCOPE. `organisation` holds what is true whatever
 * modules are switched on — the people, the departments, the calendar, who
 * signs things off. Every enabled module is a scope of its own, holding its
 * screens and its configuration and nothing else's.
 *
 * Three things fall out of this, and they are the reason it is worth the change:
 *
 *  - **An employee's shell becomes small by construction.** They are not being
 *    shown five things and refused three; each scope carries only what they may
 *    open. Payroll, for an employee, is one destination.
 *  - **The mobile bar stops overflowing for structural reasons** rather than by
 *    arithmetic. `splitNavItems` stays regardless — a cap that is only respected
 *    because nothing currently exceeds it is a cap nobody is enforcing.
 *  - **This file still names no module.** Scopes are built from manifests and
 *    from the `modules` registry table, exactly as the navigation, the
 *    dashboard, the reports screen and the settings page already are (D30, D32).
 *
 * The current scope is derived from the URL and never stored. A scope held in
 * state is a scope that disagrees with the address bar the first time somebody
 * follows a link into a module.
 */

import { supabase } from "@/integrations/supabase/client";
import { isAdmin, type CurrentUser } from "@/platform/auth";
import { getEnabledModules } from "./registry";
import type { ModuleDefinition, ModuleNavItem } from "./contract";

/**
 * The scope that belongs to no module. Not a module key, and deliberately not
 * spellable as one: `modules.key` is `^[a-z][a-z0-9_]*$`, so a real module can
 * never collide with it.
 */
export const ORGANISATION_SCOPE = "organisation";

export interface WorkspaceScope {
  /** `organisation`, or a module key. */
  key: string;
  /** What the switcher calls it. */
  name: string;
  /** This scope's destinations, already filtered to what this user may open. */
  items: ModuleNavItem[];
  /**
   * Paths below `/app` this scope owns, with no leading slash. Used to decide
   * which scope an arbitrary URL belongs to — taken from the module's declared
   * routes rather than guessed from its key, because a module's paths are its
   * own business and nothing obliges them to start with it.
   */
  owns: readonly string[];
}

/** A module the switcher shows but cannot enter, and the reason why. */
export interface UnavailableScope {
  key: string;
  name: string;
  /** "not switched on" · "coming soon" — shown next to the name. */
  reason: string;
}

/**
 * What the platform itself owns.
 *
 * Everything here is true of the workspace whatever modules it runs. Departments
 * are the example Sada gave and the clearest one: the department column exists
 * on a leave report and a salary register alike, and a workspace with two
 * department lists has two answers to who works where.
 *
 * Approvals is here rather than in a module for the reason it always was — one
 * queue lists everything waiting on you, whatever raised it. Reports likewise:
 * it is a platform destination that modules fill, and it already groups its
 * contents by module, so splitting it across scopes would take a working screen
 * apart to no end.
 */
export function organisationScope(user: CurrentUser | null): WorkspaceScope {
  const items: ModuleNavItem[] = [{ label: "Dashboard", to: "/app" }];

  // Managers are not administrators, so this cannot hang off isAdmin().
  if (user?.roles.some((r) => r === "manager" || r === "hr_admin" || r === "org_admin")) {
    items.push({ label: "Approvals", to: "/app/approvals" });
  }

  if (isAdmin(user)) {
    items.push({ label: "People", to: "/app/members" });
    items.push({ label: "Reports", to: "/app/reports" });
    items.push({ label: "Approval rules", to: "/app/approval-rules" });
    items.push({ label: "Settings", to: "/app/settings" });
  }

  return {
    key: ORGANISATION_SCOPE,
    name: "Organisation",
    items,
    owns: ["", "approvals", "members", "reports", "approval-rules", "settings", "import", "setup"],
  };
}

/**
 * One module's world: its own destinations, then its configuration.
 *
 * The Settings entry appears only for an administrator of a module that
 * actually contributes configuration. A module with nothing to configure gets
 * no settings link, rather than a link to an empty page — and the link being
 * absent is not what refuses a non-administrator. `/app/settings/<key>` checks
 * for itself, because a screen that is merely not linked is not a permission.
 */
export function moduleScope(m: ModuleDefinition, user: CurrentUser | null): WorkspaceScope {
  const items = m.navigation(user).filter((item) => {
    if (!item.roles || item.roles.length === 0) return true;
    return item.roles.some((r) => user?.roles.includes(r));
  });

  const configurable = isAdmin(user) && (m.adminSections?.(user) ?? []).length > 0;
  if (configurable) items.push({ label: "Settings", to: `/app/settings/${m.key}` });

  return {
    key: m.key,
    name: m.name,
    items,
    owns: [...m.routes.map((r) => r.path), `settings/${m.key}`],
  };
}

/**
 * Every scope this user can actually enter: the organisation, then each enabled
 * module in the order the build registered them.
 *
 * A module that contributes no destination this user may open is left out
 * entirely. An empty scope in the switcher is a door onto a blank room.
 */
export async function getWorkspaceScopes(user: CurrentUser | null): Promise<WorkspaceScope[]> {
  const enabled = await getEnabledModules();
  return [organisationScope(user), ...enabled.map((m) => moduleScope(m, user))].filter(
    (s) => s.items.length > 0,
  );
}

/**
 * Modules the switcher should name but cannot open — granted and switched off,
 * or in the registry and not built yet.
 *
 * Shown rather than hidden, and this is the same judgement `soon:` makes in the
 * navigation contract: an administrator wondering where Attendance went is
 * better served by seeing it greyed with a reason than by an interface that
 * behaves as though it never existed. Read from the `modules` table, so
 * Learning appears here the day somebody inserts a row and nothing in this file
 * changes.
 *
 * Administrators only. An employee cannot switch a module on and has no use for
 * a list of what they are missing.
 */
export async function getUnavailableScopes(user: CurrentUser | null): Promise<UnavailableScope[]> {
  if (!isAdmin(user)) return [];

  const [registry, enabled] = await Promise.all([
    supabase.from("modules").select("key, name, status"),
    getEnabledModules(),
  ]);

  if (registry.error) return [];
  const on = new Set(enabled.map((m) => m.key));

  return (registry.data ?? [])
    .filter((r) => !on.has(r.key))
    .map((r) => ({
      key: r.key,
      name: r.name,
      // A module that exists but is switched off is a different problem from one
      // that has not been built, and the admin can act on exactly one of them.
      reason: r.status === "available" ? "not switched on" : "coming soon",
    }));
}

/**
 * Which scope an address belongs to.
 *
 * Longest match wins. `leave` and `leave/apply` are both owned by Leave, but a
 * shorter path from another scope must never beat a longer, more specific one —
 * and `""` (the dashboard) would otherwise prefix-match everything.
 */
export function scopeForPath(
  scopes: readonly WorkspaceScope[],
  pathname: string,
): WorkspaceScope | undefined {
  const path = pathname.replace(/^\/app\/?/, "").replace(/\/+$/, "");

  let best: WorkspaceScope | undefined;
  let bestLength = -1;

  for (const scope of scopes) {
    for (const owned of scope.owns) {
      const matches = owned === "" ? path === "" : path === owned || path.startsWith(`${owned}/`);
      if (matches && owned.length > bestLength) {
        best = scope;
        bestLength = owned.length;
      }
    }
  }

  return best;
}

/**
 * Platform · Shell · What the rail and the tab bar show
 *
 * Built from module manifests and the person's roles, and from nothing else
 * (D32). This file names no module. It contributes two entries of its own:
 *
 *   · Home, the platform dashboard and the one approvals queue, because the
 *     queue lists everything waiting on you whatever raised it.
 *   · Organisation, for administrators: People, Approval rules, Reports and
 *     Settings, which are true of the workspace with every module switched off.
 *
 * Each module gets its own tabs from `navigation`, and the platform adds the
 * ones every module shares in the Core HR layout when the module has something
 * to put there: `Approvals` (For your team) if it raises approvals and the
 * person can approve, and `Reports` and `Configuration` (behind Company) if it
 * contributes them and the person administers. Those three open the platform's
 * own screens with `?m=<key>`, which is how the rail knows which module is
 * selected on a screen that several modules share.
 *
 * A tab the role cannot use is not built here at all, so it cannot be rendered
 * disabled by mistake. What is counted instead is how many were left out,
 * which is the "N tabs hidden for this role" note.
 */

import type { ComponentType } from "react";
import type { CurrentUser } from "@/platform/auth";
import { canApprove, isAdmin, isModuleAdmin } from "@/platform/auth";
import type { ModuleDefinition, ModuleSection } from "@/platform/modules";

export type TabGroup = "main" | "team" | "company";

export interface ShellTab {
  /** Unique within its module. */
  id: string;
  label: string;
  to: string;
  /** `?m=` for a platform screen opened from inside a module. */
  module?: string;
  group: TabGroup;
  /** One line, shown in the Company menu and the section picker. */
  description?: string;
  /** Pending items, shown as a red count. */
  badge?: number;
  /** Not built yet: rendered as visibly unavailable, never as a dead link. */
  soon?: string;
}

export interface ShellModule {
  key: string;
  name: string;
  short: string;
  section: ModuleSection;
  icon?: ComponentType<{ className?: string }>;
  tabs: ShellTab[];
  /** How many tabs this module has that the person's roles do not reach. */
  hiddenForRole: number;
}

export const HOME_KEY = "home";
export const ORG_KEY = "organisation";

export interface ShellIcons {
  home?: ShellModule["icon"];
  organisation?: ShellModule["icon"];
}

export function buildShell(
  user: CurrentUser | null,
  enabled: readonly ModuleDefinition[],
  icons: ShellIcons = {},
): ShellModule[] {
  const approver = canApprove(user);
  const admin = isAdmin(user);

  const home: ShellModule = {
    key: HOME_KEY,
    name: "Home",
    short: "Home",
    section: "Company",
    icon: icons.home,
    tabs: [
      { id: "dashboard", label: "Dashboard", to: "/app", group: "main" },
      // D79. Everybody's own: how they sign in, including face or fingerprint.
      { id: "security", label: "Sign-in and security", to: "/app/security", group: "main" },
      ...(approver
        ? [
            {
              id: "approvals",
              label: "Approvals",
              to: "/app/approvals",
              group: "team" as const,
              description: "Everything waiting on you, from every module",
            },
          ]
        : []),
    ],
    hiddenForRole: approver ? 0 : 1,
  };

  const modules = enabled.map((m): ShellModule => {
    const tabs: ShellTab[] = [];
    let hidden = 0;

    for (const item of m.navigation(user)) {
      const byRole = !!item.roles?.length && item.roles.some((r) => user?.roles.includes(r));
      const allowed =
        (!item.roles?.length && !item.moduleAdmin) ||
        byRole ||
        (!!item.moduleAdmin && isModuleAdmin(user, m.key));
      if (!allowed) {
        hidden++;
        continue;
      }
      tabs.push({
        id: item.to ?? item.label,
        label: item.label,
        to: item.to ?? "",
        group: item.group ?? "main",
        description: item.description,
        soon: item.to ? item.soon : (item.soon ?? "later"),
      });
    }

    if (m.approvalEntityTypes.length > 0) {
      if (approver) {
        tabs.push({
          id: "approvals",
          label: "Approvals",
          to: "/app/approvals",
          module: m.key,
          group: "team",
          description: `${m.name} requests waiting on you`,
        });
      } else hidden++;
    }

    const companyTabs: ShellTab[] = [];
    if (m.reports) {
      companyTabs.push({
        id: "reports",
        label: "Reports",
        to: "/app/reports",
        module: m.key,
        group: "company",
        description: m.reportsDescription ?? `${m.name} reports and exports`,
      });
    }
    if (m.adminSections) {
      companyTabs.push({
        id: "configuration",
        label: "Configuration",
        to: "/app/settings",
        module: m.key,
        group: "company",
        description: m.configurationDescription ?? `How ${m.name} works in this workspace`,
      });
    }
    if (isModuleAdmin(user, m.key)) tabs.push(...companyTabs);
    else hidden += companyTabs.length;

    return {
      key: m.key,
      name: m.name,
      short: m.shortName ?? m.name,
      section: m.section ?? "Company",
      icon: m.icon,
      tabs,
      hiddenForRole: hidden,
    };
  });

  const organisation: ShellModule | null = admin
    ? {
        key: ORG_KEY,
        name: "Organisation",
        short: "Organisation",
        section: "Company",
        icon: icons.organisation,
        tabs: [
          { id: "people", label: "People", to: "/app/members", group: "main" },
          {
            id: "approval-rules",
            label: "Approval rules",
            to: "/app/approval-rules",
            group: "main",
          },
          {
            id: "reports",
            label: "Reports",
            to: "/app/reports",
            group: "company",
            description: "Every report from every module, in one place",
          },
          {
            id: "settings",
            label: "Settings",
            to: "/app/settings",
            group: "company",
            description: "Company identity, departments, holidays, modules",
          },
        ],
        hiddenForRole: 0,
      }
    : null;

  return [home, ...modules, ...(organisation ? [organisation] : [])];
}

/**
 * Sections in first-appearance order, each with its modules.
 *
 * Not "emit a heading whenever the section changes": a module appended out of
 * section order would then produce a second heading for a section already
 * shown. Collecting unique sections first is what makes order in the registry
 * not matter.
 */
export function groupBySection(modules: readonly ShellModule[]) {
  const order: ModuleSection[] = [];
  const by = new Map<ModuleSection, ShellModule[]>();
  for (const m of modules) {
    if (!by.has(m.section)) {
      by.set(m.section, []);
      order.push(m.section);
    }
    by.get(m.section)!.push(m);
  }
  return order.map((section) => ({ section, modules: by.get(section)! }));
}

/** Headings appear once the suite passes six modules; below that they are noise. */
export const SECTION_HEADINGS_FROM = 7;

export interface Location {
  pathname: string;
  /** The `?m=` search parameter, if any. */
  module?: string;
}

/**
 * Which module and tab the person is on.
 *
 * `?m=` wins when it names a module that is present, because a shared platform
 * screen has no other way to say whose context it was opened in. Otherwise the
 * longest tab path that prefixes the pathname wins, so `/app/leave/apply`
 * selects "Apply Leave" and not "My Leave" at `/app/leave`. Nothing matching
 * falls back to Home rather than to nothing, so the rail always has a selection.
 */
export function locate(
  modules: readonly ShellModule[],
  { pathname, module }: Location,
): { module: ShellModule; tab: ShellTab | null } {
  const path = pathname.replace(/\/+$/, "") || "/";

  const scoped = module ? modules.find((m) => m.key === module) : undefined;
  const candidates = scoped ? [scoped] : modules;

  let best: { module: ShellModule; tab: ShellTab; length: number } | null = null;
  for (const m of candidates) {
    for (const t of m.tabs) {
      if (!t.to) continue;
      if (!scoped && t.module) continue; // a module's view of a platform screen needs ?m=
      const exact = path === t.to;
      const prefix = t.to !== "/app" && path.startsWith(t.to + "/");
      if (!exact && !prefix) continue;
      const length = exact ? t.to.length + 1 : t.to.length;
      if (!best || length > best.length) best = { module: m, tab: t, length };
    }
  }

  if (best) return { module: best.module, tab: best.tab };
  if (scoped) return { module: scoped, tab: null };
  return { module: modules[0], tab: null };
}

/** The search object a tab's link carries. */
export function tabSearch(tab: ShellTab): Record<string, string> | undefined {
  return tab.module ? { m: tab.module } : undefined;
}

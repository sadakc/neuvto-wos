/**
 * Platform · Module registry
 *
 * Resolves which modules a given user actually has: the modules compiled into
 * this build, intersected with the ones their organisation has switched on.
 *
 * The platform never imports a module. It is handed the list by
 * `src/modules/registry.ts`, which is the only file outside a module folder
 * permitted to name one — enforced in CI. That indirection is what makes
 * deleting a module a two-line operation instead of a search across the
 * codebase.
 */

import { supabase } from "@/integrations/supabase/client";
import type { CurrentUser } from "@/platform/auth";
import {
  ModuleDefinitionSchema,
  type ModuleApprovalView,
  type ModuleDefinition,
  type ModuleAdminSection,
  type ModuleReport,
  type ModuleDashboardCard,
  type ModuleNavItem,
} from "./contract";

let installed: readonly ModuleDefinition[] = [];

/**
 * Called once at startup by the application entry point. Validates every
 * manifest immediately, because a malformed one should fail loudly at boot
 * rather than as an empty sidebar somebody debugs later.
 *
 * Duplicate keys, duplicate routes and duplicate approval entity types are all
 * rejected here. The Approval Engine is entity-agnostic by design and would
 * happily let two modules claim `leave_request` between them.
 */
export function installModules(modules: readonly ModuleDefinition[]): void {
  const keys = new Set<string>();
  const routes = new Set<string>();
  const entityTypes = new Set<string>();

  for (const m of modules) {
    const parsed = ModuleDefinitionSchema.safeParse(m);
    if (!parsed.success) {
      throw new Error(`Module "${m?.key ?? "(unknown)"}" has an invalid manifest: ${parsed.error}`);
    }

    if (keys.has(m.key)) throw new Error(`Two modules declare the key "${m.key}".`);
    keys.add(m.key);

    for (const r of m.routes) {
      if (routes.has(r.path)) {
        throw new Error(`Route "${r.path}" is claimed by more than one module.`);
      }
      routes.add(r.path);
    }

    for (const t of m.approvalEntityTypes) {
      if (entityTypes.has(t)) {
        throw new Error(`Approval entity type "${t}" is claimed by more than one module.`);
      }
      entityTypes.add(t);
    }

    // A view for an entity type the module never claimed would simply never be
    // reached: the queue looks views up by the `entity_type` the engine reports,
    // and nothing would ever report this one. The symptom is an approvals queue
    // that renders the neutral fallback forever while the manifest looks correct,
    // so it fails at boot instead.
    const claimed = new Set(m.approvalEntityTypes);
    for (const v of m.approvalViews?.(null) ?? []) {
      if (!claimed.has(v.entityType)) {
        throw new Error(
          `Module "${m.key}" registers an approval view for "${v.entityType}", ` +
            `which is not in its approvalEntityTypes.`,
        );
      }
    }
  }

  installed = modules;
}

/** Every module in this build, enabled or not. Admin screens need this. */
export function allModules(): readonly ModuleDefinition[] {
  return installed;
}

export function moduleByKey(key: string): ModuleDefinition | undefined {
  return installed.find((m) => m.key === key);
}

/**
 * The modules this organisation has switched on.
 *
 * A module absent from `organization_modules`, or present and disabled, is off.
 * Defaulting to on would mean shipping a new module instantly turns it on for
 * every existing customer, which is not a decision code should make.
 */
export async function getEnabledModules(): Promise<readonly ModuleDefinition[]> {
  const { data, error } = await supabase
    .from("organization_modules")
    .select("module_key, enabled")
    .eq("enabled", true);

  // RLS scopes this to the caller's organisation, so no filter is needed here —
  // and none should be added, because a filter in application code implies the
  // policy cannot be trusted.
  if (error) return [];

  const on = new Set((data ?? []).map((r) => r.module_key));
  return installed.filter((m) => on.has(m.key));
}

/**
 * Navigation contributed by enabled modules, for this user.
 *
 * Role filtering here is presentation only. What a person can actually read is
 * decided by RLS; hiding a link they cannot use is courtesy, not security.
 */
export async function getModuleNavigation(user: CurrentUser | null): Promise<ModuleNavItem[]> {
  const enabled = await getEnabledModules();

  return enabled.flatMap((m) =>
    m.navigation(user).filter((item) => {
      if (!item.roles || item.roles.length === 0) return true;
      return item.roles.some((r) => user?.roles.includes(r));
    }),
  );
}

/**
 * Dashboard cards from enabled modules, for this user, in declared order.
 *
 * A module that contributes none is simply absent — the dashboard must not
 * render an empty frame for it, and must still work when no module is enabled
 * at all. That last case is what the module-removal check exercises.
 */
export async function getDashboardCards(
  user: CurrentUser | null,
): Promise<(ModuleDashboardCard & { moduleKey: string })[]> {
  const enabled = await getEnabledModules();

  return enabled
    .flatMap((m) => (m.dashboardCards?.(user) ?? []).map((card) => ({ ...card, moduleKey: m.key })))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Configuration blocks from enabled modules, for this user, in declared order.
 *
 * The settings page renders these without importing a module or knowing one
 * exists — which is what keeps "configure leave types" inside
 * `src/modules/leave/` where every other leave decision lives. A module that
 * contributes none is simply absent, and settings still works when no module is
 * enabled at all: the module-removal check exercises exactly that.
 */
export async function getAdminSections(
  user: CurrentUser | null,
): Promise<(ModuleAdminSection & { moduleKey: string })[]> {
  const enabled = await getEnabledModules();

  return enabled
    .flatMap((m) => (m.adminSections?.(user) ?? []).map((s) => ({ ...s, moduleKey: m.key })))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Every report the enabled modules contribute, in order.
 *
 * Same shape as `getAdminSections`, and for the same reason: `/app/reports`
 * renders these without importing a module or knowing one exists. A workspace
 * with no modules enabled gets an empty Reports screen rather than a broken one
 * — the module-removal check exercises precisely that path.
 */
export async function getModuleReports(
  user: CurrentUser | null,
): Promise<(ModuleReport & { moduleKey: string })[]> {
  const enabled = await getEnabledModules();

  return enabled
    .flatMap((m) => (m.reports?.(user) ?? []).map((r) => ({ ...r, moduleKey: m.key })))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * How to render each entity type currently awaiting decisions, keyed by the
 * string `approval_queue()` reports.
 *
 * Returns a Map rather than a list because the queue's question is always "what
 * renders THIS row", asked once per row.
 *
 * A row whose module is disabled — or removed from the build entirely — resolves
 * to nothing here, and the queue is required to render it anyway through its
 * fallback. A pending decision that disappears from the only screen that would
 * surface it is somebody's leave silently never being decided, which is the
 * whole failure this step exists to end.
 */
export async function getApprovalViews(
  user: CurrentUser | null,
): Promise<Map<string, ModuleApprovalView & { moduleKey: string }>> {
  const enabled = await getEnabledModules();
  const views = new Map<string, ModuleApprovalView & { moduleKey: string }>();

  for (const m of enabled) {
    for (const v of m.approvalViews?.(user) ?? []) {
      views.set(v.entityType, { ...v, moduleKey: m.key });
    }
  }
  return views;
}

/** Resolves a path below /app to the module route that serves it, if any. */
export async function resolveModuleRoute(path: string) {
  const normalised = path.replace(/^\/+|\/+$/g, "");
  const enabled = await getEnabledModules();

  for (const m of enabled) {
    const match = m.routes.find((r) => r.path === normalised);
    if (match) return { module: m, route: match };
  }
  return undefined;
}

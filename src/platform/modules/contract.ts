/**
 * Platform · Module contract
 *
 * What a business module declares about itself. This is the whole of the
 * coupling between the platform and a module: the platform reads manifests, and
 * a module names no part of the platform's internals.
 *
 * The point is change isolation. Editing Leave should mean editing
 * `src/modules/leave/` and nothing else — no shared navigation file, no route
 * table, no settings switch statement. Before this existed,
 * `components/shared/app-nav.tsx` hardcoded "Apply", "My leave" and "Approvals",
 * which meant a shared file had to be edited to change a module.
 *
 * This is NOT a security boundary and must never be read as one. All modules are
 * written in-house. Tenant isolation is enforced by RLS in the database, exactly
 * as it is for everything else; these rules buy maintainability, nothing more.
 *
 * It is also not an extensibility API — no frozen surface, no semver. When the
 * platform needs to change, it changes and the modules in this repo change with
 * it.
 */

import { z } from "zod";
import type { ComponentType, LazyExoticComponent } from "react";
import type { AppRole, CurrentUser } from "@/platform/auth";

/**
 * A destination in the shell's navigation. `soon` renders it as visibly
 * unavailable rather than as a link to nothing — a module can therefore
 * advertise where it is going before it gets there.
 */
export interface ModuleNavItem {
  label: string;
  to?: string;
  soon?: string;
  /** Omitted means everyone. Presence means at least one of these roles. */
  roles?: readonly AppRole[];
}

/**
 * A card a module contributes to the dashboard.
 *
 * The dashboard belongs to the platform; an employee's leave balance belongs to
 * Leave. Without this, `src/routes/app/index.tsx` would have to name a module to
 * show anything useful — the coupling removed from `app-nav.tsx`, reintroduced
 * one screen over.
 */
export interface ModuleDashboardCard {
  /** Stable across renders; used as the React key and for ordering. */
  id: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
  /** Lower sorts first. Platform content always precedes module content. */
  order?: number;
}

/**
 * A block of configuration a module contributes to Settings.
 *
 * Same reasoning as `dashboardCards`, one screen over. Leave types belong to
 * Leave; the settings page belongs to the platform. Without this, configuring
 * leave would mean `src/routes/app/settings.tsx` importing a module — the exact
 * coupling `app-nav.tsx` shed in step 6, reintroduced by the back door.
 *
 * Rendered only for administrators. That is presentation: RLS is what actually
 * refuses the write.
 */
export interface ModuleAdminSection {
  /** Stable across renders; used as the React key and for ordering. */
  id: string;
  title: string;
  /** One line under the heading, saying what this configures and for whom. */
  description?: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
  /** Lower sorts first. Platform configuration always precedes module configuration. */
  order?: number;
}

export interface ModuleRoute {
  /** Relative to /app, no leading slash. "leave/apply" serves /app/leave/apply. */
  path: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
}

/**
 * Declared, not wired.
 *
 * Everything here is data the platform can read, validate and render without
 * importing a module's internals — which is exactly what keeps the blast radius
 * of a change inside one folder. Same reasoning as D5 (approval chains are rows,
 * not code) and D7 (`module_settings` is JSONB so a new module needs no
 * migration).
 */
export interface ModuleDefinition {
  /** Must match a `modules.key` row. The registry asserts this at startup. */
  key: string;
  name: string;
  version: string;

  /**
   * A function, not an array, because what a manager sees differs from what an
   * employee sees. Hiding a link is presentation; RLS is what actually refuses
   * the data.
   */
  navigation: (user: CurrentUser | null) => ModuleNavItem[];

  routes: ModuleRoute[];

  /**
   * Rendered on the dashboard, for organisations that have this module enabled.
   * A function of the user for the same reason navigation is: a manager's
   * dashboard is not an employee's.
   */
  dashboardCards?: (user: CurrentUser | null) => ModuleDashboardCard[];

  /**
   * Rendered on the settings page for administrators of organisations that have
   * this module enabled. A function of the user for the same reason the others
   * are — and because "what may I configure" is a different question from "what
   * may I see".
   */
  adminSections?: (user: CurrentUser | null) => ModuleAdminSection[];

  /**
   * Entity types this module registers with the Approval Engine. Declared so
   * two modules cannot silently claim the same one — the engine is
   * entity-agnostic and would happily let them.
   */
  approvalEntityTypes: readonly string[];

  /** Event keys this module emits. The Notification Engine templates these. */
  eventKeys: readonly string[];

  /**
   * Per-organisation configuration, persisted through `module_settings` (D7).
   * Customers configure modules even though they never write them.
   */
  settingsSchema: z.ZodTypeAny;

  /**
   * Tables this module owns, which CI checks against the schema its migrations
   * actually create. Ownership that is only claimed in a comment is ownership
   * nobody can verify.
   */
  ownedTables: readonly string[];
}

/**
 * Validated at registry load rather than trusted. A malformed manifest is a
 * developer error that should surface immediately and loudly, not as a blank
 * navigation bar that takes an afternoon to trace.
 */
export const ModuleDefinitionSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "Module key must be lower snake_case, matching modules.key"),
  name: z.string().min(1),
  version: z.string().min(1),
  navigation: z.function(),
  routes: z.array(
    z.object({
      path: z
        .string()
        .regex(/^[a-z0-9][a-z0-9/_-]*$/, "Route path is relative to /app with no leading slash"),
      component: z.any(),
    }),
  ),
  dashboardCards: z.function().optional(),
  adminSections: z.function().optional(),
  approvalEntityTypes: z.array(z.string().regex(/^[a-z_]+$/)).readonly(),
  eventKeys: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).readonly(),
  settingsSchema: z.any(),
  ownedTables: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).readonly(),
});

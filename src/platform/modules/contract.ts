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
import type { ApprovalQueueItem } from "@/platform/approvals";

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

/**
 * A report a module contributes to the platform's Reports screen.
 *
 * The spec calls reports "module-local in MVP; generalise when a second module
 * reports" — this IS that generalisation, arriving early because the alternative
 * was worse. A `/app/leave/reports` route would need a navigation entry, and
 * that is where it becomes a platform problem:
 *
 * `mergeNavItems` places module items at positions 2–4, and the mobile bar shows
 * the first FIVE. A fifth module item pushes "Approvals" off the bar for an
 * administrator — the identical bug the team calendar caused in step 10, found
 * only by opening the app at 280px wide. Reports belong with People and Settings,
 * which sit past position five deliberately, because admin work is desktop-first.
 *
 * So the platform owns a Reports destination and modules fill it, exactly as
 * they fill Settings and the dashboard. D30 holds: the platform renders a page
 * of reports without knowing that any of them concern leave.
 *
 * Rendered only for administrators. That is presentation — every report function
 * behind these raises FORBIDDEN for a non-admin itself, because a screen that is
 * merely not linked is not a permission.
 */
export interface ModuleReport {
  /** Stable across renders; used as the React key, for ordering, and in the URL hash. */
  id: string;
  title: string;
  /** One line under the heading: what question this answers, for whom. */
  description?: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
  /** Lower sorts first. */
  order?: number;
}

export interface ModuleRoute {
  /** Relative to /app, no leading slash. "leave/apply" serves /app/leave/apply. */
  path: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
}

/**
 * How a module renders one thing awaiting a decision.
 *
 * The approvals queue belongs to the platform: it is one screen listing
 * everything waiting on you, whatever raised it, because a manager should not
 * have to visit a different queue per module to find out what they are holding
 * up. The Approval Engine has been entity-agnostic since step 4 — it drove a
 * throwaway entity type end to end before a leave table existed — and this keeps
 * the screen above it the same way.
 *
 * So `approval_queue()` hands the screen an `entity_type` it treats as an opaque
 * string, and whichever module claimed that string in `approvalEntityTypes`
 * renders the row. Leave knows what a leave request looks like; the platform
 * never finds out.
 *
 * The alternative — an approvals screen inside Leave — was considered and
 * declined with Sada. It is less work exactly once, and then Attendance arrives
 * and either builds a second queue or this gets written anyway.
 */
/**
 * What the queue hands a module's renderer.
 *
 * The platform defines this, because the platform is what passes it — the module
 * decides what to *do* with a row, not what a row is. `item.context` is the
 * module's own jsonb from `approval_submit`, opaque to everything above.
 */
export interface ModuleApprovalViewProps {
  item: ApprovalQueueItem;
  /** Call after a decision lands, so the queue can refresh itself. */
  onDecided: () => void;
}

export interface ModuleApprovalView {
  /**
   * Must be one of this module's own `approvalEntityTypes`. The registry checks
   * it, because a view registered for a string the module never claimed would
   * silently never render.
   */
  entityType: string;
  /**
   * Receives one queue row. Renders the summary and, expanded, whatever the
   * approver needs to decide — for Leave that means a balance the platform has
   * no business knowing the shape of.
   */
  component:
    | ComponentType<ModuleApprovalViewProps>
    | LazyExoticComponent<ComponentType<ModuleApprovalViewProps>>;
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
   * Reports this module contributes to the platform's Reports screen.
   *
   * A function of the user for the same reason the others are: a module decides
   * what it is willing to show whom, and the platform does not need to know the
   * rule.
   */
  reports?: (user: CurrentUser | null) => ModuleReport[];

  /**
   * Entity types this module registers with the Approval Engine. Declared so
   * two modules cannot silently claim the same one — the engine is
   * entity-agnostic and would happily let them.
   */
  approvalEntityTypes: readonly string[];

  /**
   * How this module renders its own entities in the platform's approvals queue.
   * A function of the user for the same reason the others are: what a manager
   * may act on is not what an administrator may.
   */
  approvalViews?: (user: CurrentUser | null) => ModuleApprovalView[];

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
  reports: z.function().optional(),
  approvalViews: z.function().optional(),
  approvalEntityTypes: z.array(z.string().regex(/^[a-z_]+$/)).readonly(),
  eventKeys: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).readonly(),
  settingsSchema: z.any(),
  ownedTables: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).readonly(),
});

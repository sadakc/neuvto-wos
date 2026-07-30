/**
 * Leave Management — the module's entire public surface.
 *
 * Nothing outside this folder imports anything deeper than this file, and only
 * `src/modules/registry.ts` imports it at all. Both rules are enforced in CI.
 *
 * The manifest below is the whole of what the platform knows about Leave. It
 * declares — navigation, routes, the approval entity type it claims, the events
 * it emits, its settings, the tables it owns — and the platform reads that
 * without ever importing a handler or a component.
 */

import { lazy } from "react";
import type { ModuleDefinition } from "@/platform/modules";
import { LeaveSettings } from "./contracts";

export const leave: ModuleDefinition = {
  key: "leave",
  name: "Leave Management",
  version: "1.0.0",

  navigation: () => [
    { label: "Apply", to: "/app/leave/apply" },
    { label: "My leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
    // Arrives in step 8. Declared here rather than in a shared navigation file,
    // so the module owns its own roadmap.
    { label: "Approvals", soon: "step 8", roles: ["manager", "hr_admin", "org_admin"] },
  ],

  routes: [
    { path: "leave", component: lazy(() => import("./components/MyLeave")) },
    { path: "leave/apply", component: lazy(() => import("./components/ApplyLeave")) },
    { path: "leave/calendar", component: lazy(() => import("./components/LeaveCalendar")) },
  ],

  dashboardCards: () => [
    {
      id: "leave-balance",
      component: lazy(() => import("./components/LeaveDashboardCard")),
      order: 10,
    },
  ],

  // Registered with the Approval Engine, which knows nothing about leave and
  // would happily let a second module claim the same string.
  approvalEntityTypes: ["leave_request"],

  // Emitted through the platform. This module never sends an email.
  eventKeys: ["approval.submitted", "approval.decided", "approval.completed"],

  settingsSchema: LeaveSettings,

  ownedTables: ["leave_types", "leave_balances", "leave_requests"],
};

export { submitLeave, getMyBalances, getMyRequests, getLeaveTypes } from "./handlers";

export {
  SubmitLeaveInput,
  LeaveSettings,
  LEAVE_STATUSES,
  leaveErrorMessage,
  type LeaveStatus,
  type LeaveBalance,
  type LeaveRequest,
  type ApprovalStep,
} from "./contracts";

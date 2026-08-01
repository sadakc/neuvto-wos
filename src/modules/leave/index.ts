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

  navigation: (user) => [
    { label: "Apply", to: "/app/leave/apply" },
    { label: "My leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
    // A manager's view of the same calendar: who on their team is away, and
    // when. "Approvals" used to be declared here too, as `soon: "step 8"` — a
    // module laying claim to a platform screen. It now lives in the platform's
    // own navigation, and this module contributes only how to render its rows.
    ...(user?.roles.some((r) => r === "manager" || r === "hr_admin" || r === "org_admin")
      ? [{ label: "Team", to: "/app/leave/team" }]
      : []),
  ],

  routes: [
    { path: "leave", component: lazy(() => import("./components/MyLeave")) },
    { path: "leave/apply", component: lazy(() => import("./components/ApplyLeave")) },
    { path: "leave/calendar", component: lazy(() => import("./components/LeaveCalendar")) },
    { path: "leave/team", component: lazy(() => import("./components/TeamCalendar")) },
  ],

  dashboardCards: () => [
    {
      id: "leave-balance",
      component: lazy(() => import("./components/LeaveDashboardCard")),
      order: 10,
    },
  ],

  // What an administrator configures. Contributed rather than routed: the
  // platform's settings page renders this without importing anything here, the
  // same way the dashboard renders the balance card.
  adminSections: () => [
    {
      id: "leave-types",
      title: "Leave types",
      description:
        "What people in this workspace can apply for, and how many days a year each one allows.",
      component: lazy(() => import("./components/LeaveTypes")),
      order: 10,
    },
  ],

  // Registered with the Approval Engine, which knows nothing about leave and
  // would happily let a second module claim the same string.
  approvalEntityTypes: ["leave_request"],

  // How a leave request looks in the platform's approvals queue. The queue is
  // handed `entity_type` as an opaque string and asks whoever claimed it to
  // render the row — so the screen shows a balance, a leave type and a date
  // range without the platform knowing any of those words.
  approvalViews: () => [
    {
      entityType: "leave_request",
      component: lazy(() => import("./components/LeaveApprovalCard")),
    },
  ],

  // Emitted through the platform. This module never sends an email.
  eventKeys: ["approval.submitted", "approval.decided", "approval.completed"],

  settingsSchema: LeaveSettings,

  ownedTables: ["leave_types", "leave_balances", "leave_requests"],
};

export {
  submitLeave,
  getMyBalances,
  getMyRequests,
  getApprovalDetail,
  getLeaveTypes,
  listLeaveTypes,
  saveLeaveType,
  setLeaveTypeStatus,
} from "./handlers";

export {
  SubmitLeaveInput,
  LeaveTypeInput,
  LeaveSettings,
  type LeaveType,
  LEAVE_STATUSES,
  leaveErrorMessage,
  type LeaveStatus,
  type LeaveBalance,
  type LeaveRequest,
  type ApprovalStep,
  type LeaveApprovalDetail,
} from "./contracts";

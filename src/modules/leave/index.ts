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
import { CalendarDays } from "lucide-react";
import type { ModuleDefinition } from "@/platform/modules";
import { LeaveSettings } from "./contracts";

export const leave: ModuleDefinition = {
  key: "leave",
  name: "Leave Management",
  version: "1.0.0",
  shortName: "Leave",
  section: "Time",
  icon: CalendarDays,
  reportsDescription: "Balances, leave taken, what is waiting",
  configurationDescription:
    "Leave types, opening balances, blackout periods, the carry-forward review and notifications",

  // "Approvals" used to be declared here, as `soon: "step 8"` — a module laying
  // claim to a platform screen. It now lives in the platform's own navigation,
  // and this module contributes only how to render its rows.
  //
  // The team calendar deliberately gets NO nav entry. It is reached from the
  // Calendar screen, because it is a view of that calendar rather than a peer
  // destination — and because the mobile bar shows five items and nothing else.
  // Adding a sixth pushed "Approvals" off it, so a manager on a phone could not
  // reach the one screen they are needed on. Found by opening it at 280px wide;
  // the desktop sidebar showed all six and looked perfect.
  navigation: () => [
    // Core HR labels (D76). Apply first: it is what most people come for.
    { label: "Apply Leave", to: "/app/leave/apply" },
    { label: "My Leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
  ],

  routes: [
    { path: "leave", component: lazy(() => import("./components/MyLeave")) },
    { path: "leave/apply", component: lazy(() => import("./components/ApplyLeave")) },
    { path: "leave/calendar", component: lazy(() => import("./components/LeaveCalendar")) },
    { path: "leave/team", component: lazy(() => import("./components/TeamCalendar")) },
    // D89. No nav entry, like the team calendar: reached from My Leave, which
    // offers it only where the company has compensatory off.
    { path: "leave/comp-off", component: lazy(() => import("./components/CompOff")) },
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
      id: "opening-balances",
      title: "Opening balances",
      description:
        "Leave your people had already taken before Neuvto, and days carried over. Somebody who has taken six days but shows a full balance will be allowed to book leave they have not got.",
      component: lazy(() => import("./components/OpeningBalances")),
      order: 20,
    },
    {
      id: "blackouts",
      title: "Blackout periods",
      description:
        "Dates when nobody can apply for leave, paid or unpaid: an audit, a peak season. Leave already applied for is not changed.",
      component: lazy(() => import("./components/Blackouts")),
      order: 30,
    },
    {
      id: "carry-forward",
      title: "Carry-forward review",
      description:
        "What each person takes into next year. Nothing changes until you lock the review, and a locked review is final.",
      component: lazy(() => import("./components/CarryForwardReview")),
      order: 40,
    },
    {
      id: "notifications",
      title: "Notifications",
      description:
        "Who is told when leave is applied for, decided or moves up. What the approver and the person asking always hear is locked on.",
      component: lazy(() => import("./components/LeaveNotifications")),
      order: 50,
    },
    {
      id: "leave-types",
      title: "Leave types",
      description:
        "What people in this workspace can apply for, and how many days a year each one allows.",
      component: lazy(() => import("./components/LeaveTypes")),
      order: 10,
    },
  ],

  // What an administrator can take away and open in Excel. Contributed, like
  // the settings sections above, so the platform's Reports screen renders them
  // without importing anything here or knowing that any of it concerns leave.
  //
  // Administrators only, agreed with Sada. Managers already have Approvals and
  // the Team Calendar; these three are every person in the workspace at once,
  // and widening them would put a colleague's sick-leave consumption in front of
  // more people than D35 allows elsewhere. The rule is not enforced here — each
  // function raises FORBIDDEN itself, because a screen that is merely not linked
  // is not a permission.
  reports: () => [
    {
      id: "leave-balances",
      title: "Leave balances",
      description:
        "Who has what left. Every active person against every active leave type, for the current leave year.",
      component: lazy(() => import("./components/LeaveBalancesReport")),
      order: 10,
    },
    {
      id: "leave-taken",
      title: "Leave taken",
      description:
        "What happened. Every request overlapping the dates you choose, including the rejected and cancelled ones.",
      component: lazy(() => import("./components/LeaveTakenReport")),
      order: 20,
    },
    {
      id: "leave-pending",
      title: "Pending approvals",
      description:
        "What is stuck. Everything awaiting a decision, longest wait first, and everyone who can act on it now.",
      component: lazy(() => import("./components/LeavePendingReport")),
      order: 30,
    },
    // D94.
    {
      id: "leave-liability",
      title: "Leave liability",
      description:
        "What is still owed this year, in days: not yet taken, already booked, free to book.",
      component: lazy(() => import("./components/LeaveLiabilityReport")),
      order: 40,
    },
    {
      id: "comp-off-register",
      title: "Compensatory off register",
      description:
        "Every claim in the dates you choose: the days worked, what became of it, what expired.",
      component: lazy(() => import("./components/CompOffRegisterReport")),
      order: 50,
    },
    {
      id: "approval-turnaround",
      title: "Approval turnaround",
      description: "How long each decision took, who made it, and what had to move up.",
      component: lazy(() => import("./components/ApprovalTurnaroundReport")),
      order: 60,
    },
    {
      id: "absenteeism",
      title: "Absenteeism",
      description: "Approved leave in the dates you choose, per person, with the Bradford factor.",
      component: lazy(() => import("./components/AbsenteeismReport")),
      order: 70,
    },
  ],

  // Registered with the Approval Engine, which knows nothing about leave and
  // would happily let a second module claim the same string.
  approvalEntityTypes: ["leave_request", "comp_off_claim"],

  // How a leave request looks in the platform's approvals queue. The queue is
  // handed `entity_type` as an opaque string and asks whoever claimed it to
  // render the row — so the screen shows a balance, a leave type and a date
  // range without the platform knowing any of those words.
  approvalViews: () => [
    {
      entityType: "leave_request",
      component: lazy(() => import("./components/LeaveApprovalCard")),
    },
    {
      entityType: "comp_off_claim",
      component: lazy(() => import("./components/CompOffApprovalCard")),
    },
  ],

  // Emitted through the platform. This module never sends an email.
  eventKeys: ["approval.submitted", "approval.decided", "approval.completed"],

  // D111. Where this module's notices open from the bell. A request waiting
  // on you opens Leave approvals (the platform's answer); your own request,
  // sent (D112) or decided, opens My Leave; a summary opens the reports.
  notificationLinks: {
    "approval.sent": () => "/app/leave",
    "approval.completed": () => "/app/leave",
    "leave_summary.weekly": () => "/app/reports?m=leave",
    "leave_summary.monthly": () => "/app/reports?m=leave",
  },

  settingsSchema: LeaveSettings,

  ownedTables: [
    "leave_types",
    "leave_balances",
    "leave_requests",
    "leave_blackouts",
    "leave_opening_staged",
    "comp_off_claims",
    "comp_off_claim_days",
  ],
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
  getLeaveBalancesReport,
  getLeaveTakenReport,
  getLeavePendingReport,
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
  type LeaveBalanceReportRow,
  type LeaveTakenReportRow,
  type LeavePendingReportRow,
} from "./contracts";

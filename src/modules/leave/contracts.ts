/**
 * Leave contracts.
 *
 * Zod schemas are the source of truth; types derive from them so the two cannot
 * drift (CODING_STANDARDS §3). The rules here mirror the database's — a form
 * that accepts what leave_submit() will reject produces an unexplained failure,
 * which is worse than a validation message.
 */

import { z } from "zod";

export const LEAVE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine((d) => !Number.isNaN(Date.parse(d)), "Choose a real date");

export const SubmitLeaveInput = z
  .object({
    leaveTypeId: z.string().uuid("Choose a leave type"),
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: "The end date cannot be before the start date",
    path: ["toDate"],
  });
export type SubmitLeaveInput = z.infer<typeof SubmitLeaveInput>;

/**
 * A leave type, as an administrator configures it.
 *
 * Every rule here mirrors a CHECK constraint in `leave_types` exactly. A form
 * that accepts what the database refuses produces an unexplained failure, which
 * is worse than a validation message — and this project has met that bug more
 * than once.
 */
export const LeaveTypeInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give this leave type a name").max(60, "That name is too long"),
  description: z.string().trim().max(300, "Keep the description under 300 characters").optional(),
  /** leave_type_days_sane: >= 0. Zero is legitimate — an unpaid type with no allowance. */
  maxDaysPerYear: z
    .number({ invalid_type_error: "Enter a number of days" })
    .min(0, "Days per year cannot be negative")
    .max(365, "That is more days than there are in a year"),
  /** leave_type_notice_sane: null or >= 0. */
  minNoticeDays: z.number().int().min(0, "Notice cannot be negative").max(365).nullable(),
  /** leave_type_per_request_sane: null or > 0. Null means no limit — not zero. */
  maxPerRequest: z
    .number()
    .positive("A maximum per request must be more than zero")
    .max(365)
    .nullable(),
  /**
   * D38. False means approved the moment it is submitted. The reason this
   * exists in the interface at all: a workspace with one person in it has
   * nobody who can approve anything, because D13 forbids self-approval.
   */
  approvalRequired: z.boolean(),
});
export type LeaveTypeInput = z.infer<typeof LeaveTypeInput>;

export interface LeaveType {
  id: string;
  name: string;
  description: string | null;
  maxDaysPerYear: number;
  minNoticeDays: number | null;
  maxPerRequest: number | null;
  approvalRequired: boolean;
  status: "active" | "archived";
}

/**
 * Per-organisation settings, persisted through `module_settings` (D7) rather
 * than a column, so adding a setting needs no migration. Customers configure
 * modules even though they do not write them.
 */
export const LeaveSettings = z.object({
  allowHalfDays: z.boolean().default(false),
  showTeamCalendar: z.boolean().default(true),
});
export type LeaveSettings = z.infer<typeof LeaveSettings>;

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  fyLabel: string;
  entitledDays: number;
  carryforwardDays: number;
  usedDays: number;
  reservedDays: number;
  pendingDays: number;
  availableDays: number;
}

export interface ApprovalStep {
  level: number;
  approverName: string;
  decision: "pending" | "approved" | "rejected";
  comments: string | null;
  decidedAt: string | null;
}

export interface LeaveRequest {
  id: string;
  /** Null only if the approval could not be attached — the timeline needs it. */
  approvalRequestId: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  reason: string | null;
  status: LeaveStatus;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

/**
 * One leave request as an approver sees it.
 *
 * The balance fields are for the **requested type only** — see
 * `getApprovalDetail`. They are nullable because a request booked into a
 * financial year nobody has materialised yet has no balance row, and a confident
 * `0` there would read as "this person has nothing left" rather than "we have
 * not worked it out".
 */
export interface LeaveApprovalDetail {
  leaveRequestId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  reason: string | null;
  status: LeaveStatus;
  fyLabel: string | null;
  entitledDays: number | null;
  usedDays: number | null;
  availableDays: number | null;
}

/**
 * A row of each of the three reports, in this module's own vocabulary.
 *
 * `departmentName`, `decidedBy`, `waitingOn` and `reason` are nullable and the
 * generated database types say otherwise — Supabase declares every column a
 * function returns as non-null, and three of these are outer joins or scalar
 * subqueries that legitimately produce nothing. Somebody with no department is
 * the common case in a workspace that has not configured any.
 */
export interface LeaveBalanceReportRow {
  employeeId: string;
  employeeName: string;
  departmentName: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  fyLabel: string;
  entitledDays: number;
  carryforwardDays: number;
  usedDays: number;
  availableDays: number;
}

export interface LeaveTakenReportRow {
  leaveRequestId: string;
  employeeName: string;
  departmentName: string | null;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  status: LeaveStatus;
  submittedAt: string | null;
  decidedAt: string | null;
  /** The last person to act. Null while it is still pending, which is the honest answer. */
  decidedBy: string | null;
  /** What the approver said. Distinct from `reason`, which is what the employee said. */
  decisionNote: string | null;
  reason: string | null;
}

export interface LeavePendingReportRow {
  leaveRequestId: string;
  employeeName: string;
  departmentName: string | null;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  submittedAt: string | null;
  /** Counted in the organisation's own days, not the server's — see the migration. */
  daysWaiting: number;
  currentLevel: number;
  requiredLevels: number;
  /** Everyone who could act right now; a level can have more than one approver. */
  waitingOn: string | null;
}

/**
 * Every refusal leave_submit() can raise, mapped to something a person can act
 * on. The database raises a stable code precisely so this mapping can exist —
 * showing a raw Postgres message to an employee is how a product loses trust in
 * a single screen.
 */
export const LEAVE_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Please sign in again.",
  NO_ORGANIZATION: "Your account isn't attached to an organisation yet.",
  LEAVE_TYPE_NOT_FOUND: "That leave type is no longer available.",
  INVALID_DATE_RANGE: "The end date cannot be before the start date.",
  PAST_DATE: "You can't apply for leave in the past.",
  // Kept as the fallback only. leave_submit raises the required number with the
  // code, so the message below is built in leaveErrorMessage() — see there for
  // why the number comes from the database rather than from the form.
  INSUFFICIENT_NOTICE: "This leave type needs more notice than that.",
  NO_WORKING_DAYS: "Those dates are all weekend or holiday — there's nothing to book.",
  OVERLAPPING_REQUEST: "You already have leave booked over some of those dates.",
  EXCEEDS_MAX_PER_REQUEST: "That's more days than this leave type allows in one request.",
  NEXT_YEAR_NOT_OPEN_YET:
    "Next year's leave isn't open for booking yet. It opens shortly before the new leave year starts.",
  NOT_YOUR_REQUEST: "That request isn't yours to cancel.",
  ALREADY_DECIDED: "This request has already been settled and can't be cancelled.",
  CANCEL_TOO_LATE:
    "This leave has already started, so it can't be cancelled here. Speak to your manager.",
  // Reworded after Sada met it as the only person in his own workspace, being
  // told to ask an administrator — about himself. It now says what can actually
  // be done, and both routes out are things an admin has a screen for.
  // "Members" was the route (/app/members), not the screen. The sidebar says
  // People, so that is what somebody goes looking for — an error that names a
  // destination the navigation does not have is a dead end with extra steps.
  APPROVER_UNRESOLVED:
    "Nobody can approve this yet. Set a manager for this person under People, or mark this leave type as needing no approval.",
  // D44. The module is off for this workspace — either Neuvto has not granted
  // it, or their own administrator switched it off. Deliberately does not say
  // which: a customer's employee should hear this from their administrator, not
  // infer their employer's commercial arrangements from an error message.
  MODULE_NOT_ENABLED: "Leave isn't switched on for this workspace. Ask your administrator.",
  // The three reports raise this rather than returning an empty set, so that a
  // report somebody may not see cannot be mistaken for a report with nothing in
  // it. This message is what makes that distinction visible.
  FORBIDDEN: "Reports cover everybody in the workspace, so they're limited to administrators.",
  LEAVE_TYPE_NAME_TAKEN: "There's already a leave type with that name.",
  LEAVE_TYPE_IN_USE:
    "This leave type has leave booked against it, so it can't be removed. Archive it instead — the history stays and nobody can book new leave.",
};

/** INSUFFICIENT_BALANCE and INSUFFICIENT_NOTICE carry numbers, so both match by prefix. */
export function leaveErrorMessage(code: string): string {
  // The required notice comes back from leave_submit rather than being read off
  // the form, because the form's copy of min_notice_days is as old as the page.
  // An administrator who changes a leave type from 1 day to 5 while somebody has
  // the form open would otherwise produce a refusal explaining the wrong number
  // — and the number is the whole point of the message.
  if (code.startsWith("INSUFFICIENT_NOTICE")) {
    const m = code.match(/(\d+)\s*days?\s*required/i);
    if (!m) return LEAVE_ERROR_MESSAGES.INSUFFICIENT_NOTICE;
    const days = Number(m[1]);
    return `This leave type needs at least ${days} ${days === 1 ? "day" : "days"} of notice before you apply.`;
  }
  if (code.startsWith("INSUFFICIENT_BALANCE")) {
    const m = code.match(/requested\s+([\d.]+),\s+available\s+([\d.]+)/);
    return m
      ? `You asked for ${m[1]} days but have ${m[2]} available.`
      : "You don't have enough days available.";
  }
  return LEAVE_ERROR_MESSAGES[code] ?? "That didn't work. Please try again.";
}

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
  APPROVER_UNRESOLVED:
    "Nobody can approve this yet. Set a manager for this person under Members, or mark this leave type as needing no approval.",
  // D44. The module is off for this workspace — either Neuvto has not granted
  // it, or their own administrator switched it off. Deliberately does not say
  // which: a customer's employee should hear this from their administrator, not
  // infer their employer's commercial arrangements from an error message.
  MODULE_NOT_ENABLED: "Leave isn't switched on for this workspace. Ask your administrator.",
  LEAVE_TYPE_NAME_TAKEN: "There's already a leave type with that name.",
  LEAVE_TYPE_IN_USE:
    "This leave type has leave booked against it, so it can't be removed. Archive it instead — the history stays and nobody can book new leave.",
};

/** INSUFFICIENT_BALANCE carries the numbers, so it is matched by prefix. */
export function leaveErrorMessage(code: string): string {
  if (code.startsWith("INSUFFICIENT_BALANCE")) {
    const m = code.match(/requested\s+([\d.]+),\s+available\s+([\d.]+)/);
    return m
      ? `You asked for ${m[1]} days but have ${m[2]} available.`
      : "You don't have enough days available.";
  }
  return LEAVE_ERROR_MESSAGES[code] ?? "That didn't work. Please try again.";
}

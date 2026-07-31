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
  APPROVER_UNRESOLVED:
    "There's nobody set up to approve this. Ask your administrator to assign a manager.",
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

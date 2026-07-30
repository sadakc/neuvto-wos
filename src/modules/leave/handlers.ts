/**
 * Leave handlers.
 *
 * Thin wrappers over the database functions, which are the actual service. The
 * rules live in SQL deliberately: a working day, an entitlement and a balance
 * have to mean the same thing to a handler, a constraint and a report, and
 * expressing them twice guarantees the two eventually disagree.
 *
 * Note what is absent — no approval routing, no email, no audit write. The
 * module hands off to platform services and has no opinion about any of them.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError } from "@/platform/errors";
import {
  SubmitLeaveInput,
  leaveErrorMessage,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveStatus,
  type ApprovalStep,
} from "./contracts";

/**
 * Postgres raises a bare code; this turns it into something an employee can
 * read. The code survives in `details` so a support conversation can still
 * reach the real cause.
 */
function toLeaveError(message: string): AppError {
  const code = message.replace(/^.*?:\s*/, "").trim() || message;
  return new AppError("VALIDATION_FAILED", leaveErrorMessage(code), 400, { code });
}

export async function submitLeave(input: SubmitLeaveInput): Promise<string> {
  const parsed = SubmitLeaveInput.parse(input);

  const { data, error } = await supabase.rpc("leave_submit", {
    _leave_type_id: parsed.leaveTypeId,
    _from_date: parsed.fromDate,
    _to_date: parsed.toDate,
    _reason: parsed.reason,
  });

  if (error) throw toLeaveError(error.message);
  return data as string;
}

export async function getMyBalances(): Promise<LeaveBalance[]> {
  // RLS scopes this to the caller. No employee filter is added here on purpose:
  // a filter in application code implies the policy is not trusted, and the one
  // place it gets forgotten is the leak.
  const { data, error } = await supabase
    .from("leave_balances")
    .select(
      "leave_type_id, fy_label, entitled_days, carryforward_days, used_days, reserved_days, pending_days, available_days, leave_types(name)",
    );

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load your leave balance.", 500);

  return (data ?? []).map((r) => ({
    leaveTypeId: r.leave_type_id,
    leaveTypeName: (r.leave_types as { name: string } | null)?.name ?? "Leave",
    fyLabel: r.fy_label,
    entitledDays: Number(r.entitled_days),
    carryforwardDays: Number(r.carryforward_days),
    usedDays: Number(r.used_days),
    reservedDays: Number(r.reserved_days),
    pendingDays: Number(r.pending_days),
    availableDays: Number(r.available_days),
  }));
}

export async function getMyRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "id, leave_type_id, from_date, to_date, working_days, reason, status, submitted_at, decided_at, rejection_reason, leave_types(name)",
    )
    .order("from_date", { ascending: false });

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load your leave requests.", 500);

  return (data ?? []).map((r) => ({
    id: r.id,
    leaveTypeId: r.leave_type_id,
    leaveTypeName: (r.leave_types as { name: string } | null)?.name ?? "Leave",
    fromDate: r.from_date,
    toDate: r.to_date,
    workingDays: Number(r.working_days),
    reason: r.reason,
    status: r.status as LeaveStatus,
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at,
    rejectionReason: r.rejection_reason,
  }));
}

/**
 * Cancels own future leave. The database decides whether it is allowed and
 * returns a named reason if not — this never pre-judges, because a rule
 * duplicated in the browser is a rule that will one day disagree.
 */
export async function cancelLeave(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_cancel", { _request_id: requestId });
  if (error) throw toLeaveError(error.message);
}

/**
 * Who has to approve, who already has, and what they said. Employees can read
 * their own steps — `is_requester_of` in the approval engine's policy — so this
 * needs no special privilege.
 */
export async function getApprovalTimeline(approvalRequestId: string): Promise<ApprovalStep[]> {
  const { data, error } = await supabase
    .from("approval_steps")
    .select(
      "level, decision, comments, decided_at, profiles!approval_steps_approver_id_fkey(full_name)",
    )
    .eq("approval_request_id", approvalRequestId)
    .order("level");

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load the approval history.", 500);

  return (data ?? []).map((r) => ({
    level: r.level,
    approverName: (r.profiles as { full_name: string | null } | null)?.full_name ?? "Approver",
    decision: r.decision as ApprovalStep["decision"],
    comments: r.comments,
    decidedAt: r.decided_at,
  }));
}

export async function getLeaveTypes(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("leave_types")
    .select("id, name")
    .eq("status", "active")
    .order("name");

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load the leave types.", 500);
  return data ?? [];
}

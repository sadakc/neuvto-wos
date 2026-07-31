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
  LeaveTypeInput,
  leaveErrorMessage,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
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

/**
 * The caller's balances — and the read that CREATES them.
 *
 * This used to select `leave_balances` directly, and returned nothing at all
 * for a workspace whose administrator had just configured leave types. D12 has
 * always said balance rows are created lazily on first read, and
 * `ensure_balance` is commented that way, but its only caller was
 * `leave_submit`. Nothing read, so nothing was created, and the dashboard said
 * "you don't have a leave balance yet" until somebody guessed their way through
 * a submission against a number no screen could show them.
 *
 * `leave_my_balances()` is that missing read (D36). It takes no employee id,
 * deliberately.
 */
export async function getMyBalances(): Promise<LeaveBalance[]> {
  const { data, error } = await supabase.rpc("leave_my_balances");

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load your leave balance.", 500);

  return (data ?? []).map((r) => ({
    leaveTypeId: r.leave_type_id,
    leaveTypeName: r.leave_type_name ?? "Leave",
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
      "id, approval_request_id, leave_type_id, from_date, to_date, working_days, reason, status, submitted_at, decided_at, rejection_reason, leave_types(name)",
    )
    .order("from_date", { ascending: false });

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load your leave requests.", 500);

  return (data ?? []).map((r) => ({
    id: r.id,
    approvalRequestId: r.approval_request_id,
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
  // A dedicated function rather than a join. An employee cannot read the
  // approver's profile — they see only their own — so the join returned no name
  // and the timeline said "Approver". This discloses the name and nothing else
  // about them (D35).
  const { data, error } = await supabase.rpc("approval_timeline", {
    _approval_request_id: approvalRequestId,
  });

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load the approval history.", 500);

  return (data ?? []).map((r) => ({
    level: r.level,
    approverName: r.approver_name,
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

// ─────────────────────────────────────────────────────────── administration
//
// The screens below were the gap Sada found first: the database has allowed an
// administrator to write leave_types since step 6 — there is an "admins write
// leave types" policy — and nothing was ever built to do it. Settings said
// "editing arrives with the admin screens", and the workspace was unusable
// until it did.
//
// Writes go straight to the table rather than through an RPC. There is no
// invariant to protect here: the CHECK constraints hold the rules, RLS holds
// the tenancy, and a function wrapping a plain insert would only be a second
// place for the two to disagree.

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const { data, error } = await supabase
    .from("leave_types")
    .select(
      "id, name, description, max_days_per_year, min_notice_days, max_per_request, approval_required, status",
    )
    .order("status")
    .order("name");

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load the leave types.", 500);

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    maxDaysPerYear: Number(r.max_days_per_year),
    minNoticeDays: r.min_notice_days,
    maxPerRequest: r.max_per_request === null ? null : Number(r.max_per_request),
    approvalRequired: r.approval_required,
    status: r.status as LeaveType["status"],
  }));
}

/**
 * Creates or updates one. The organisation comes from the caller's own profile,
 * never from the form — a client-supplied organization_id is a cross-tenant
 * write waiting for the one policy that forgets to check it.
 */
export async function saveLeaveType(input: LeaveTypeInput, organizationId: string): Promise<void> {
  const parsed = LeaveTypeInput.parse(input);

  const row = {
    organization_id: organizationId,
    name: parsed.name,
    description: parsed.description || null,
    max_days_per_year: parsed.maxDaysPerYear,
    min_notice_days: parsed.minNoticeDays,
    max_per_request: parsed.maxPerRequest,
    approval_required: parsed.approvalRequired,
  };

  const { error } = parsed.id
    ? await supabase.from("leave_types").update(row).eq("id", parsed.id)
    : await supabase.from("leave_types").insert(row);

  if (error) {
    // uq_leave_type_name is case-insensitive, so "Casual" and "casual" collide.
    // Worth saying plainly rather than showing a constraint name.
    if (error.code === "23505" || error.message.includes("uq_leave_type_name")) {
      throw toLeaveError("LEAVE_TYPE_NAME_TAKEN");
    }
    throw toLeaveError(error.message);
  }
}

/**
 * Archive, never delete — the spec's word, and the right one. Balances and
 * requests reference this row; removing it would break the history of everybody
 * who ever took this kind of leave. Archived types stop appearing on the apply
 * form and stop getting new balance rows, and the days already taken stay
 * exactly where they are.
 */
export async function setLeaveTypeStatus(id: string, status: "active" | "archived"): Promise<void> {
  const { error } = await supabase.from("leave_types").update({ status }).eq("id", id);
  if (error) throw toLeaveError(error.message);
}

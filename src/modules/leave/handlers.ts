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
  type LeaveApprovalDetail,
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

/**
 * The caller's OWN requests. The filter is the point.
 *
 * This read has no filter until now and leaned on RLS, following the rule used
 * everywhere else here — "a filter in application code implies the policy cannot
 * be trusted". That rule is right when the policy and the screen want the same
 * rows. They do not here: `read leave requests in scope` deliberately returns
 * own OR direct reports OR requests you are an approver on OR, for an admin,
 * every one in the organisation. It is scoped for *tenancy*, not for *this
 * screen*.
 *
 * So "My leave" listed other people's leave. Found by opening it as Dan
 * Director, who has no leave at all and was shown Ravi's four approved days as
 * his own — on My Leave, on the dashboard card ("Next leave 2026-08-31"), and on
 * his personal calendar, all three of which read through here.
 *
 * Present since step 7 and invisible until step 10 gave anybody an approved
 * request to see. An administrator would have seen the entire company's leave
 * listed as their own.
 */
export async function getMyRequests(): Promise<LeaveRequest[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "id, approval_request_id, leave_type_id, from_date, to_date, working_days, reason, status, submitted_at, decided_at, rejection_reason, leave_types(name)",
    )
    .eq("employee_id", uid)
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

/**
 * Everything an approver needs to decide one leave request — and, deliberately,
 * the balance for **that leave type only**.
 *
 * Why a database function rather than a join here: an approver reached by
 * `manager_of_manager` can read the request (`is_approver_on` is in that policy)
 * and cannot read the employee's `leave_balances` rows, because that policy has
 * only own / `is_manager_of` / `is_admin`, and `is_manager_of` is
 * direct-reports-only. A join would silently return no balance and the screen
 * would show a decision with no numbers behind it.
 *
 * Widening the policy was the alternative and was declined with Sada. Deciding
 * on three days of Casual is a question the Casual row answers; it is not a
 * reason to hand somebody the employee's sick-leave consumption, which is a
 * health signal. Same rule as D35.
 */
export async function getApprovalDetail(approvalRequestId: string): Promise<LeaveApprovalDetail> {
  const { data, error } = await supabase.rpc("leave_approval_detail", {
    _approval_request_id: approvalRequestId,
  });

  if (error) throw toLeaveError(error.message);

  const r = (data ?? [])[0];
  if (!r) throw new AppError("NOT_FOUND", "We couldn't find that leave request.", 404);

  return {
    leaveRequestId: r.leave_request_id,
    employeeName: r.employee_name,
    leaveTypeId: r.leave_type_id,
    leaveTypeName: r.leave_type_name,
    fromDate: r.from_date,
    toDate: r.to_date,
    workingDays: Number(r.working_days),
    reason: r.reason,
    status: r.status as LeaveStatus,
    // Null when no balance row exists for that year — a request booked into a
    // year nobody has materialised yet. Shown as "not set up" rather than as a
    // confident zero, which would read as "they have nothing left".
    fyLabel: r.fy_label,
    entitledDays: r.entitled_days === null ? null : Number(r.entitled_days),
    usedDays: r.used_days === null ? null : Number(r.used_days),
    availableDays: r.available_days === null ? null : Number(r.available_days),
  };
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

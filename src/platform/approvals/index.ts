/**
 * Platform · Approval chains
 *
 * D5 — approval chains are data, not code. Level 1 always applies; a later level
 * applies when its condition matches. Test scenario 6 is precisely this being
 * true: *"admin edits the chain threshold from 3 to 5 → a 4-day request now
 * needs 1 level, no deploy."* That scenario has been in the spec since the
 * beginning with no screen behind it, so nothing could actually edit a chain
 * until now.
 *
 * Chains belong to the platform, not to Leave. The engine is entity-agnostic —
 * it drove a dummy entity type end to end in step 4 before any leave table
 * existed — and this service names `leave_request` only as the entity type a
 * caller asks about.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";
import type { AppRole } from "@/platform/auth";

/** One thing waiting on the caller. `entityType` is opaque here, deliberately. */
export interface ApprovalQueueItem {
  approvalRequestId: string;
  entityType: string;
  entityId: string;
  requesterId: string;
  /** The one thing disclosed about them beyond the request itself — D35. */
  requesterName: string;
  level: number;
  requiredLevels: number;
  context: Record<string, unknown>;
  createdAt: string;
  /** Whole days since it was raised. What a queue is really sorted by in a manager's head. */
  daysWaiting: number;
  /** When it reached the level it is at now. */
  levelSince: string;
  /** Whole days at this level. */
  daysAtLevel: number;
  /**
   * The level's `escalate_after_days`, or null. Past it, the request moves to
   * somebody above the approver (D87); with no target it never moves.
   */
  targetDays: number | null;
  /** Who it moved up from, when it came to the caller that way (D87). */
  escalatedFrom: string | null;
  /** Whose approval this is, when it is the caller's by delegation (D92). */
  onBehalfOf: string | null;
}

/**
 * Why a request was rejected. The codes are the database's
 * (`approval_reject_reasons()`); the words are the screen's.
 */
export const REJECT_REASONS = [
  { code: "business_need", label: "Needed at work on those dates" },
  { code: "insufficient_notice", label: "Not enough notice" },
  { code: "policy", label: "Against company policy" },
  { code: "documents_missing", label: "Documents missing" },
  { code: "other", label: "Other" },
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number]["code"];

export function rejectReasonLabel(code: string | null | undefined): string | null {
  return REJECT_REASONS.find((r) => r.code === code)?.label ?? null;
}

/**
 * What is waiting on **you**.
 *
 * No user-id parameter, and that absence is the point. The function this
 * replaces, `approval_pending_for(_user_id)`, was SECURITY DEFINER, granted to
 * `authenticated`, and took the queue's owner as an argument. Every caller
 * omitted it, so it read as "my queue" for four build steps — while anybody
 * could pass a colleague's id, and an employee knows at least one: `manager_id`
 * is on their own profile. Demonstrated on the seed: as an ordinary employee,
 * `approval_pending_for('<my manager>')` returned another employee's leave
 * request in full.
 */
export async function listApprovalQueue(): Promise<ApprovalQueueItem[]> {
  const { data, error } = await supabase.rpc("approval_queue");
  if (error) throw toAppError(error, "listApprovalQueue");

  const now = Date.now();
  const days = (iso: string) =>
    Math.max(0, Math.floor((now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));
  return (data ?? []).map((r) => ({
    approvalRequestId: r.approval_request_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    requesterId: r.requester_id,
    requesterName: r.requester_name,
    level: r.level,
    requiredLevels: r.required_levels,
    context: (r.context ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
    daysWaiting: days(r.created_at),
    levelSince: r.level_since,
    daysAtLevel: days(r.level_since),
    targetDays: r.target_days,
    escalatedFrom: r.escalated_from ?? null,
    onBehalfOf: r.on_behalf_of ?? null,
  }));
}

/**
 * Approve or reject one thing, at the level currently in play.
 *
 * The engine decides everything that matters — whether it is your turn, whether
 * it was already decided, whether another level follows — and a module reacts to
 * the outcome through its own trigger (D30). Nothing here moves a balance; the
 * arithmetic has existed since step 6 and has simply never had a caller.
 */
export async function decideApproval(
  approvalRequestId: string,
  decision: "approved" | "rejected",
  comments?: string,
  reasonCode?: RejectReason,
): Promise<void> {
  const { error } = await supabase.rpc("approval_decide", {
    _request_id: approvalRequestId,
    _decision: decision,
    _comments: comments?.trim() || undefined,
    _reason_code: reasonCode,
  });
  if (!error) return;
  throw decideError(error);
}

/** One request's outcome from approveMany. */
export interface BulkOutcome {
  approvalRequestId: string;
  approved: boolean;
  /** Why it was not approved, as a sentence; null when it was. */
  message: string | null;
}

/**
 * Approves several at once. Each goes through the same rules as one at a time,
 * and each outcome comes back separately: one refusal does not stop the rest.
 * Approve only; a rejection needs its own reason.
 */
export async function approveMany(approvalRequestIds: string[]): Promise<BulkOutcome[]> {
  const { data, error } = await supabase.rpc("approval_decide_many", {
    _request_ids: approvalRequestIds,
  });
  if (error) throw toAppError(error, "approveMany");
  return (data ?? []).map((r) => ({
    approvalRequestId: r.approval_request_id,
    approved: r.status !== null,
    message: r.error ? decideError({ message: r.error }).message : null,
  }));
}

function decideError(error: { message?: string }): AppError {
  // The database raises bare codes. Each of these is a thing a manager can
  // actually do something about, so each gets a sentence rather than a code.
  const raw = error.message ?? "";
  if (raw.includes("REASON_CODE_REQUIRED")) {
    return new AppError("VALIDATION_FAILED", "Choose why you're rejecting this.", 400);
  }
  if (raw.includes("NOTE_REQUIRED")) {
    return new AppError(
      "VALIDATION_FAILED",
      "Add a short note for the person. They'll read it with the reason.",
      400,
    );
  }
  if (raw.includes("ALREADY_SIGNING")) {
    return new AppError(
      "FORBIDDEN",
      "You already sign another level of this request, so you can't sign this one for somebody else too.",
      403,
    );
  }
  if (raw.includes("SELF_APPROVAL_FORBIDDEN")) {
    return new AppError("FORBIDDEN", "You can't decide your own request.", 403);
  }
  if (raw.includes("NOT_YOUR_APPROVAL")) {
    return new AppError(
      "FORBIDDEN",
      "This is waiting on somebody else at the moment — an earlier level hasn't been decided yet.",
      403,
    );
  }
  if (raw.includes("ALREADY_DECIDED")) {
    return new AppError(
      "ALREADY_DECIDED",
      "This has already been decided. Refresh to see where it ended up.",
      409,
    );
  }
  if (raw.includes("TENANT_MISMATCH") || raw.includes("NOT_FOUND")) {
    return new AppError("NOT_FOUND", "We couldn't find that request.", 404);
  }
  return toAppError(error as Parameters<typeof toAppError>[0], "decideApproval");
}

export const APPROVER_RULES = ["reporting_manager", "manager_of_manager", "role"] as const;
export type ApproverRule = (typeof APPROVER_RULES)[number];

export const CONDITION_OPS = [">", ">=", "<", "<=", "="] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface ApprovalLevel {
  id: string;
  level: number;
  approverRule: ApproverRule;
  /** Required when the rule is `role`, forbidden otherwise — chain_role_present. */
  approverRole: AppRole | null;
  /** All three or none of these — chain_condition_complete. */
  conditionField: string | null;
  conditionOp: ConditionOp | null;
  conditionValue: number | null;
  escalateAfterDays: number | null;
}

export async function listApprovalLevels(entityType: string): Promise<ApprovalLevel[]> {
  const { data, error } = await supabase
    .from("approval_chains")
    .select(
      "id, level, approver_rule, approver_role, condition_field, condition_op, condition_value, escalate_after_days",
    )
    .eq("entity_type", entityType)
    .order("level");

  if (error) throw toAppError(error, "listApprovalLevels");

  return (data ?? []).map((r) => ({
    id: r.id,
    level: r.level,
    approverRule: r.approver_rule as ApproverRule,
    approverRole: r.approver_role as AppRole | null,
    conditionField: r.condition_field,
    conditionOp: r.condition_op as ConditionOp | null,
    conditionValue: r.condition_value === null ? null : Number(r.condition_value),
    escalateAfterDays: r.escalate_after_days,
  }));
}

/**
 * Both CHECK constraints are mirrored here, and the messages say what to do.
 *
 * chain_role_present and chain_condition_complete exist because a half-specified
 * level is worse than a missing one: a rule of `role` with no role never
 * resolves, and a condition field with no operator silently never matches — it
 * reads as "this level does not apply" rather than as the mistake it is.
 */
function validate(level: Partial<ApprovalLevel>): string | null {
  if (level.approverRule === "role" && !level.approverRole) {
    return "Choose which role approves at this level.";
  }
  if (level.approverRule !== "role" && level.approverRole) {
    return "A role only applies when the approver is chosen by role.";
  }
  const parts = [level.conditionField, level.conditionOp, level.conditionValue];
  const set = parts.filter((p) => p !== null && p !== undefined && p !== "").length;
  if (set !== 0 && set !== 3) {
    return "A condition needs a field, a comparison and a number — or leave all three blank.";
  }
  return null;
}

export async function saveApprovalLevel(
  organizationId: string,
  entityType: string,
  level: Omit<ApprovalLevel, "id"> & { id?: string },
): Promise<void> {
  const problem = validate(level);
  if (problem) throw new AppError("VALIDATION_FAILED", problem, 400);

  const row = {
    organization_id: organizationId,
    entity_type: entityType,
    level: level.level,
    approver_rule: level.approverRule,
    approver_role: level.approverRole,
    condition_field: level.conditionField || null,
    condition_op: level.conditionOp || null,
    condition_value: level.conditionValue,
    escalate_after_days: level.escalateAfterDays,
  };

  const { error } = level.id
    ? await supabase.from("approval_chains").update(row).eq("id", level.id)
    : await supabase.from("approval_chains").insert(row);

  if (error) {
    if (error.message.includes("chain_role_present")) {
      throw new AppError("VALIDATION_FAILED", "Choose which role approves at this level.", 400);
    }
    if (error.message.includes("chain_condition_complete")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "A condition needs a field, a comparison and a number — or leave all three blank.",
        400,
      );
    }
    throw toAppError(error, "saveApprovalLevel");
  }
}

/**
 * Removes a level.
 *
 * Soft, per D17: `approval_steps` written under the old chain still reference
 * what was decided and by whom, and a hard delete would rewrite the history of
 * every request that went through it. Chains are frozen at submission (D5), so
 * removing a level changes nothing already in flight.
 */
export async function removeApprovalLevel(id: string): Promise<void> {
  const { error } = await supabase
    .from("approval_chains")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw toAppError(error, "removeApprovalLevel");
}

// ═══════════════════════════════════════════════ handing approvals over (D92)

/** One hand-over: given by the caller, received by them, or (for an admin) between others. */
export interface Delegation {
  id: string;
  direction: "given" | "received" | "others";
  delegatorName: string;
  delegateName: string;
  fromDate: string;
  toDate: string;
  /** Null: every module's approvals. */
  moduleKey: string | null;
  moduleName: string | null;
  reason: string | null;
  inForce: boolean;
}

const DELEGATION_MESSAGES: Record<string, string> = {
  DELEGATE_TO_SELF: "Choose somebody other than the person whose approvals these are.",
  DELEGATE_CANNOT_APPROVE:
    "They can't approve anything: they need a role that approves, in this company.",
  PAST_DATE: "A hand-over can't start in the past.",
  INVALID_DATE_RANGE: "The last day can't be before the first.",
  DELEGATION_TOO_LONG: "Hand approvals over for at most six months at a time.",
  DELEGATION_OVERLAPS: "Your approvals are already handed over for some of those dates.",
  MODULE_NOT_ENABLED: "That isn't switched on for this workspace.",
  FORBIDDEN: "Only a company admin can hand over somebody else's approvals.",
  NOT_FOUND: "That hand-over isn't yours to change.",
};

function delegationError(error: { message?: string }, where: string): AppError {
  const code = Object.keys(DELEGATION_MESSAGES).find((k) => (error.message ?? "").includes(k));
  return code
    ? new AppError("VALIDATION_FAILED", DELEGATION_MESSAGES[code], 400, { code })
    : toAppError(error, where);
}

export async function listMyDelegations(): Promise<Delegation[]> {
  const { data, error } = await supabase.rpc("approval_my_delegations");
  if (error) throw toAppError(error, "listMyDelegations");
  return (data ?? []).map((r) => ({
    id: r.id,
    direction: r.direction as Delegation["direction"],
    delegatorName: r.delegator_name,
    delegateName: r.delegate_name,
    fromDate: r.from_date,
    toDate: r.to_date,
    moduleKey: r.module_key,
    moduleName: r.module_name,
    reason: r.reason,
    inForce: r.in_force,
  }));
}

/** Colleagues who can be handed approvals: active, able to approve, not the caller. */
export async function listDelegateCandidates(): Promise<{ id: string; fullName: string }[]> {
  const { data, error } = await supabase.rpc("approval_delegate_candidates");
  if (error) throw toAppError(error, "listDelegateCandidates");
  return (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name }));
}

export async function delegateApprovals(input: {
  delegateId: string;
  fromDate: string;
  toDate: string;
  moduleKey: string | null;
  reason: string;
  /** A company admin handing over somebody else's; null for the caller's own. */
  delegatorId: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("approval_delegate", {
    _delegate_id: input.delegateId,
    _from_date: input.fromDate,
    _to_date: input.toDate,
    _module_key: input.moduleKey ?? undefined,
    _reason: input.reason || undefined,
    _delegator_id: input.delegatorId ?? undefined,
  });
  if (error) throw delegationError(error, "delegateApprovals");
  return data as string;
}

export async function cancelDelegation(id: string): Promise<void> {
  const { error } = await supabase.rpc("approval_delegation_cancel", { _id: id });
  if (error) throw delegationError(error, "cancelDelegation");
}

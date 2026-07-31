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

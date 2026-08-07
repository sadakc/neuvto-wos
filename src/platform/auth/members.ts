/**
 * Members and invitations, from inside a workspace.
 *
 * An administrator invites a colleague by email, role and phone. Everything an
 * invitation can refuse is named by the database and translated here — with one
 * deliberate silence.
 *
 * D40: an address already in use in ANOTHER organisation is never reported to
 * the inviting administrator. Answering "already in another workspace" would
 * turn this form into a staff-directory oracle — type addresses, watch which
 * come back duplicate, enumerate a competitor's payroll. The invitation is
 * created and simply never accepted; the person themselves is told, when they
 * arrive, about their own address. There is no error string for it here because
 * there is no error to show.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError, type ErrorCode } from "@/platform/errors";
import { InviteInput, type AppRole } from "./contracts";

export interface Member {
  id: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  joinedDate: string;
  isActive: boolean;
  /** Null means they report to nobody — an owner, or somebody not yet placed. */
  managerId: string | null;
  /** D58. Null is ordinary: a workspace with no departments configured has nobody in one. */
  departmentId: string | null;
  roles: AppRole[];
}

/** What deactivating somebody would move. Counts, so the confirmation states facts. */
export interface DeactivationImpact {
  reports: number;
  approvals: number;
}

export interface Invitation {
  id: string;
  email: string;
  phone: string | null;
  fullName: string | null;
  role: AppRole;
  /** Carried until they accept, then applied to the profile (D53). */
  departmentId: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  /** The link, so an administrator can pass it on when email is slow. */
  inviteUrl: string | null;
}

/** Duplicates INSIDE this organisation. These are the admin's own data. */
const INVITE_ERRORS: Partial<Record<ErrorCode, { message: string; field?: string }>> = {
  ALREADY_A_MEMBER: {
    message: "Somebody with that email address is already in this workspace.",
    field: "email",
  },
  ALREADY_INVITED: {
    message:
      "That email address has already been invited. Revoke the invitation to change the role.",
    field: "email",
  },
  PHONE_ALREADY_A_MEMBER: {
    message: "Somebody with that phone number is already in this workspace.",
    field: "phone",
  },
  PHONE_ALREADY_INVITED: {
    message: "That phone number has already been invited.",
    field: "phone",
  },
  INVALID_EMAIL: { message: "Enter a valid email address.", field: "email" },
  NAME_REQUIRED: {
    message: "Enter their name — it is how they appear on every screen.",
    field: "fullName",
  },
  FORBIDDEN: { message: "Only an administrator can invite people.", field: undefined },
};

export async function inviteMember(input: unknown): Promise<string> {
  const parsed = InviteInput.parse(input);

  const { data, error } = await supabase.rpc("invitation_create", {
    _email: parsed.email,
    _phone: parsed.phone || undefined,
    _role: parsed.role,
    _full_name: parsed.fullName || undefined,
    _department_id: parsed.departmentId || undefined,
  });

  if (error) {
    const code = (Object.keys(INVITE_ERRORS) as ErrorCode[]).find((k) => error.message.includes(k));
    if (code) {
      const e = INVITE_ERRORS[code]!;
      throw new AppError(code, e.message, 400, e.field ? { field: e.field } : undefined);
    }
    throw toAppError(error, "inviteMember");
  }
  return data as string;
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("invitation_revoke", { _id: id });
  if (error) {
    if (error.message.includes("INVITATION_NOT_FOUND")) {
      throw new AppError("INVITATION_NOT_FOUND", "That invitation is no longer open.", 404);
    }
    throw toAppError(error, "revokeInvitation");
  }
}

export async function listInvitations(baseUrl: string): Promise<Invitation[]> {
  // RLS scopes this to the caller's organisation and to admins. No filter is
  // added here on purpose: a filter in application code implies the policy is
  // not trusted, and the one place it gets forgotten is the leak.
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, email, phone, full_name, role, department_id, token, created_at, expires_at, accepted_at, revoked_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load the invitations.", 500);

  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    phone: r.phone,
    fullName: r.full_name,
    role: r.role as AppRole,
    departmentId: r.department_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
    revokedAt: r.revoked_at,
    inviteUrl: r.accepted_at || r.revoked_at ? null : `${baseUrl}/auth?invite=${r.token}`,
  }));
}

export async function listMembers(): Promise<Member[]> {
  // Two reads, not an embed. `user_roles.user_id` references `auth.users`, not
  // `profiles` — D4 keeps roles off the profile row deliberately, because a role
  // on a table its owner can update is a privilege-escalation hole. PostgREST
  // therefore has no relationship to traverse, and asking for one fails at
  // compile time rather than returning an empty array at runtime, which is the
  // better half of that trade.
  const [people, roles] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, phone, joined_date, is_active, manager_id, department_id")
      .order("full_name"),
    supabase.from("user_roles").select("user_id, role"),
  ]);

  if (people.error || roles.error) {
    throw new AppError("INTERNAL_ERROR", "We couldn't load the people in this workspace.", 500);
  }

  const byUser = new Map<string, AppRole[]>();
  for (const r of roles.data ?? []) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r.role as AppRole);
    byUser.set(r.user_id, list);
  }

  return (people.data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    joinedDate: r.joined_date,
    isActive: r.is_active,
    managerId: r.manager_id,
    departmentId: r.department_id,
    roles: byUser.get(r.id) ?? [],
  }));
}

/**
 * Sets who somebody reports to. `null` clears it.
 *
 * A function rather than an update, because reporting lines are the one profile
 * edit that can corrupt approval routing — a cycle makes `manager_of_manager`
 * resolve to the requester, which D13 then skips, quietly costing the request a
 * level. The database refuses the cycle; this maps the refusal to a sentence.
 */
export async function setReportingLine(
  employeeId: string,
  managerId: string | null,
): Promise<void> {
  // The generated types declare every RPC argument non-nullable, because
  // Postgres does not distinguish "has no default" from "may not be null".
  // `_manager_id` genuinely accepts null — that is how somebody is set to report
  // to nobody — so the cast is describing the database accurately, not evading
  // it.
  const { error } = await supabase.rpc("admin_set_reporting_line", {
    _employee_id: employeeId,
    _manager_id: managerId,
  } as unknown as { _employee_id: string; _manager_id: string });
  if (!error) return;

  const raw = error.message ?? "";
  if (raw.includes("REPORTING_CYCLE")) {
    throw new AppError(
      "VALIDATION_FAILED",
      "That would make two people report to each other, directly or through their managers.",
      400,
    );
  }
  if (raw.includes("SELF_MANAGED")) {
    throw new AppError("VALIDATION_FAILED", "Somebody cannot report to themselves.", 400);
  }
  if (raw.includes("MANAGER_NOT_FOUND")) {
    throw new AppError("NOT_FOUND", "That manager is no longer in this workspace.", 404);
  }
  // D57. Names the decision rather than just the refusal — Sada's own framing:
  // "If there is any report under them, then let the admin decide that they are
  // the managers." The way out is a role change, and the message says where.
  if (raw.includes("MANAGER_CANNOT_APPROVE")) {
    throw new AppError(
      "MANAGER_CANNOT_APPROVE",
      "An Employee can't have people reporting to them, because leave is approved by whoever somebody reports to. Give them the Manager, Supervisor or Coordinator role first.",
      400,
    );
  }
  throw toAppError(error, "setReportingLine");
}

/**
 * Corrects somebody's start date.
 *
 * Admin-only, because it is the number `calculate_entitlement` works from — an
 * employee editing their own turned 6 days into 12 on the seed, which is what
 * closed the blanket UPDATE grant on `profiles`. Kept editable rather than
 * frozen because a typo caught at onboarding is common and the alternative is a
 * support ticket; the existing `write_audit_log` trigger records the whole row
 * before and after, so a balance that moves later can be traced to who moved it.
 */
export async function setJoinedDate(employeeId: string, joinedDate: string): Promise<void> {
  const { error } = await supabase.rpc("admin_set_joined_date", {
    _employee_id: employeeId,
    _joined_date: joinedDate,
  });
  if (!error) return;

  const raw = error.message ?? "";
  if (raw.includes("JOINED_DATE_UNREASONABLE")) {
    throw new AppError("VALIDATION_FAILED", "That start date is too far in the future.", 400);
  }
  if (raw.includes("JOINED_DATE_REQUIRED")) {
    throw new AppError("VALIDATION_FAILED", "A start date is needed.", 400);
  }
  throw toAppError(error, "setJoinedDate");
}

/**
 * Whether the signed-in person is active, deactivated, or has no profile.
 *
 * The sign-in screen needs this because it otherwise cannot tell the two apart.
 * Once access follows `is_active`, a deactivated person's `current_org_id()` is
 * null, so `getCurrentUser` finds no profile and the app shows "You're not in a
 * workspace yet — ask your administrator to invite your address". That is wrong
 * for somebody whose access was just removed, and the advice would waste their
 * time: an invitation will not bring it back.
 *
 * Describes the caller and nobody else.
 */
export async function accountStatus(): Promise<"active" | "deactivated" | "none"> {
  const { data, error } = await supabase.rpc("my_account_status");
  if (error) return "none";
  return (data as "active" | "deactivated" | "none") ?? "none";
}

/**
 * Gives somebody their access back.
 *
 * Access and nothing else: what was handed to a successor stays with them, and
 * cancelled leave stays cancelled. Reversing those weeks later would change who
 * a third person reports to, decided by a click on somebody else's record.
 */
export async function reactivateMember(employeeId: string): Promise<void> {
  const { error } = await supabase.rpc("reactivate_employee", {
    _employee_id: employeeId,
  });
  if (error) throw toAppError(error, "reactivateMember");
}

/** What deactivating this person would move, for the confirmation. */
export async function deactivationImpact(employeeId: string): Promise<DeactivationImpact> {
  const { data, error } = await supabase.rpc("deactivation_impact", {
    _employee_id: employeeId,
  });
  if (error) throw toAppError(error, "deactivationImpact");

  const d = (data ?? {}) as { reports?: number; approvals?: number };
  return { reports: Number(d.reports ?? 0), approvals: Number(d.approvals ?? 0) };
}

/**
 * Deactivates somebody and hands their work to a named successor, in one
 * transaction (D14).
 *
 * Deliberately not a flag flip. Before this existed an administrator could set
 * `is_active = false` in one statement, stranding every approval routed to that
 * person — which is what D14 has forbidden since the first draft and what
 * nothing enforced.
 */
export async function deactivateMember(
  employeeId: string,
  successorId: string,
): Promise<DeactivationImpact & { levelsCollapsed: number }> {
  const { data, error } = await supabase.rpc("deactivate_employee", {
    _employee_id: employeeId,
    _successor_id: successorId,
  });

  if (error) {
    const raw = error.message ?? "";
    if (raw.includes("CANNOT_DEACTIVATE_SELF")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "You can't deactivate yourself. Ask another administrator.",
        400,
      );
    }
    // D57, and the reason it is checked here as well as on the reporting line:
    // this function moves reports and pending approval steps DIRECTLY, so it is
    // a second way to give somebody a team. Only raised when there is actually
    // something to hand over.
    if (raw.includes("SUCCESSOR_CANNOT_APPROVE")) {
      throw new AppError(
        "MANAGER_CANNOT_APPROVE",
        "This person's reports and approvals have to go to somebody who can approve leave. Choose a manager, supervisor, coordinator or administrator.",
        400,
      );
    }
    if (raw.includes("SUCCESSOR_IS_REQUESTER")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "That person has a request of their own waiting here, so they can't take over these approvals. Choose somebody else.",
        400,
      );
    }
    if (raw.includes("SUCCESSOR_REQUIRED")) {
      throw new AppError("VALIDATION_FAILED", "Choose who takes over their work.", 400);
    }
    if (raw.includes("LAST_ADMIN")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "They're the only administrator left. Make somebody else an administrator first, or there will be nobody who can undo this.",
        400,
      );
    }
    if (raw.includes("SUCCESSOR_NOT_FOUND")) {
      throw new AppError("NOT_FOUND", "That person is no longer active in this workspace.", 404);
    }
    throw toAppError(error, "deactivateMember");
  }

  const d = (data ?? {}) as {
    reports_moved?: number;
    approvals_moved?: number;
    levels_collapsed?: number;
  };
  return {
    reports: Number(d.reports_moved ?? 0),
    approvals: Number(d.approvals_moved ?? 0),
    levelsCollapsed: Number(d.levels_collapsed ?? 0),
  };
}

/**
 * The people who report directly to the caller.
 *
 * A platform service rather than a query inside a module, because "who reports
 * to whom" is not Leave's idea — Attendance and Shift Planning will ask the same
 * question, and `manager_id` lives on `profiles`, which no module owns.
 *
 * Direct reports only, matching `is_manager_of()` in the database exactly. That
 * function is what the RLS policies use, so anything broader here would render a
 * team the policies then refuse to populate — a screen full of names and no data.
 */
export async function listDirectReports(): Promise<Pick<Member, "id" | "fullName" | "email">[]> {
  const { data, error } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (error || !uid) return [];

  const { data: reports, error: failed } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("manager_id", uid)
    .eq("is_active", true)
    .order("full_name");

  if (failed) throw new AppError("INTERNAL_ERROR", "We couldn't load your team.", 500);

  return (reports ?? []).map((r) => ({ id: r.id, fullName: r.full_name, email: r.email }));
}

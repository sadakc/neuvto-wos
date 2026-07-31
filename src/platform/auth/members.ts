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
  roles: AppRole[];
}

export interface Invitation {
  id: string;
  email: string;
  phone: string | null;
  fullName: string | null;
  role: AppRole;
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
  FORBIDDEN: { message: "Only an administrator can invite people.", field: undefined },
};

export async function inviteMember(input: unknown): Promise<string> {
  const parsed = InviteInput.parse(input);

  const { data, error } = await supabase.rpc("invitation_create", {
    _email: parsed.email,
    _phone: parsed.phone || undefined,
    _role: parsed.role,
    _full_name: parsed.fullName || undefined,
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
      "id, email, phone, full_name, role, token, created_at, expires_at, accepted_at, revoked_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load the invitations.", 500);

  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    phone: r.phone,
    fullName: r.full_name,
    role: r.role as AppRole,
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
      .select("id, full_name, email, phone, joined_date, is_active")
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
    roles: byUser.get(r.id) ?? [],
  }));
}

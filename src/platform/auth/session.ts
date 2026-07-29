/**
 * Session and current-user resolution.
 *
 * Everything the app needs to decide what a person may see: identity, tenant
 * and roles. Roles are read from `user_roles`, never from a column on the
 * profile (D4) — a role on a user-editable row is a privilege-escalation hole.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";
import type { AppRole, CurrentUser } from "./contracts";

/** The signed-in user's id, or null. Does not throw when signed out. */
export async function getUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw toAppError(error, "getUserId");
  return data.session?.user.id ?? null;
}

/**
 * Loads the current user with their organisation and roles.
 *
 * Returns null when signed out. Throws NO_ORGANIZATION when authenticated but
 * without a profile — that means they verified an email and never completed
 * signup, and the caller should send them to finish it rather than to an app
 * shell with no tenant.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw toAppError(sessionError, "getCurrentUser");

  const session = sessionData.session;
  if (!session) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, organization_id, organizations(name)")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileError) throw toAppError(profileError, "getCurrentUser.profile");

  if (!profile) {
    throw new AppError("NO_ORGANIZATION", "Your account is not linked to a workspace yet.", 404);
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.user.id);

  if (rolesError) throw toAppError(rolesError, "getCurrentUser.roles");

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    organizationId: profile.organization_id,
    organizationName: profile.organizations?.name ?? "",
    roles: (roleRows ?? []).map((r) => r.role as AppRole),
  };
}

export function hasRole(user: CurrentUser | null, role: AppRole): boolean {
  return user?.roles.includes(role) ?? false;
}

/** Mirrors the database `is_admin()` — org_admin or hr_admin. */
export function isAdmin(user: CurrentUser | null): boolean {
  return hasRole(user, "org_admin") || hasRole(user, "hr_admin");
}

/** Anyone who can approve: an explicit manager, or an admin. */
export function canApprove(user: CurrentUser | null): boolean {
  return hasRole(user, "manager") || isAdmin(user);
}

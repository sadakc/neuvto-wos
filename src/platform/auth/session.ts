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
 * The address this browser is signed in as, straight from the session.
 *
 * Not the same question as `getCurrentUser()?.email`, and that is the point:
 * this answers in the case where `getCurrentUser` **throws**. Neuvto staff have
 * no profile by design (D42), so it raises NO_ORGANIZATION for them — and the
 * screen that has to say "you are signed in as …" is precisely the one shown to
 * a person with no profile. Reading the session directly is the only way to name
 * them.
 */
export async function getSessionEmail(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw toAppError(error, "getSessionEmail");
  return data.session?.user.email ?? null;
}

/**
 * When this session began, as the server recorded it.
 *
 * `last_sign_in_at` is set by GoTrue at verification and is NOT touched by
 * refresh-token rotation, which makes it the only honest absolute-session clock
 * available to the browser. The tempting alternative — stamping a start time
 * into localStorage — resets the moment somebody clears site data, which is the
 * one thing an absolute timeout must not allow.
 */
export async function getSessionStartedAt(): Promise<number | null> {
  // Null on ANY failure, never a throw, and deliberately never a report.
  //
  // This function's contract — stated in `IdleInput.sessionStartedAt` and
  // honoured by `decide()` — is "null when it cannot be read, which disables
  // the absolute check rather than guessing". It previously threw
  // `toAppError`, which contradicted that contract in a way nobody could see:
  // its only caller is `idle.ts`, which writes `.catch(() => null)` and so
  // tolerated the throw exactly as designed — but `toAppError` REPORTS before
  // it throws, so the tolerated outcome still landed in `client_errors` as an
  // application fault.
  //
  // That is what happened on 6 Aug 2026 at 08:05. The idle timeout fired for
  // the first time in production, `end()` called `signOut()`, and a token
  // refresh already in flight was discarded — supabase-js raises
  // `AuthRefreshDiscardedError` for precisely this, and it is a normal
  // consequence of signing out, not a fault. Nobody saw anything. The error
  // store recorded a crash.
  //
  // An error store that logs the system working is how the store stops being
  // read, which costs more than the entry is worth.
  const { data, error } = await supabase.auth.getSession().catch(() => ({
    data: { session: null },
    error: new Error("session unreadable"),
  }));
  if (error) return null;
  const iso = data.session?.user.last_sign_in_at;
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
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

/**
 * Anyone who can approve.
 *
 * Mirrors `is_approver_role()` in the database (D57), which is the copy that
 * actually decides anything — this one only decides what a screen offers.
 *
 * Note what is absent: `employee`. And note that this is deliberately NOT
 * `isAdmin` plus extras — a Supervisor approves leave for their own reports and
 * administers nothing, so Settings, People and the workspace-wide reports stay
 * closed to them.
 *
 * This function was never the enforcement. Approvals resolve through
 * `resolve_approver`, whose first rule reads `profiles.manager_id` — a column
 * with no opinion about the role attached to it. That is why D57 guards where a
 * manager is SET rather than where one is read.
 */
export function canApprove(user: CurrentUser | null): boolean {
  return (
    hasRole(user, "manager") ||
    hasRole(user, "supervisor") ||
    hasRole(user, "coordinator") ||
    isAdmin(user)
  );
}

/**
 * Platform · Auth · Face and fingerprint sign-in (D79)
 *
 * A passkey is the W3C WebAuthn credential that Face ID, Touch ID, Windows
 * Hello and Android fingerprint unlock. The private key never leaves the
 * device; Neuvto stores only the public half, through Supabase Auth's own
 * passkey support. Nothing here is paid for.
 *
 * Two facts shape this file.
 *
 * ── it is opted into here, not in the client
 *
 * Supabase marks passkeys experimental and refuses every passkey call unless
 * the auth client was created with `experimental: { passkey: true }`. The
 * client is `src/integrations/supabase/client.ts`, which Lovable generates and
 * regenerates; an edit there is the kind that silently disappears. The flag is
 * read on every call rather than at construction, so it is switched on here,
 * in a file we own, immediately before each use. `passkeys.test.ts` pins that
 * behaviour against the installed library, so an upgrade that changes it
 * fails CI instead of quietly breaking sign-in.
 *
 * ── the email code always remains
 *
 * A passkey is an extra way in, never the only one. Somebody whose phone is
 * lost, whose browser does not support it, or who simply cancels the prompt is
 * one email code away from their account. That is also why a cancelled prompt
 * is not an error: it is somebody choosing the other door.
 *
 * Access still follows `is_active` (D52). A deactivated person's passkey signs
 * them in and buys nothing, exactly as their email code would, because
 * `current_org_id()` is null for them and every policy refuses.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError } from "@/platform/errors";

/** Switches the experimental passkey API on for an auth client. */
export function enablePasskeysOn(client: object): void {
  const auth = client as { experimental?: { passkey?: boolean } };
  auth.experimental = { ...(auth.experimental ?? {}), passkey: true };
}

function enablePasskeys(): void {
  enablePasskeysOn(supabase.auth);
}

/**
 * Whether this device can do face or fingerprint at all.
 *
 * "Platform authenticator" is WebAuthn's term for the one built into the
 * device, as opposed to a USB security key. Asked so the sign-in page does not
 * offer a button that can only fail.
 */
export async function deviceSupportsPasskeys(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** The person dismissed the system prompt. Not a failure. */
export function isCancelled(error: unknown): boolean {
  const e = error as { name?: string; code?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.name === "NotAllowedError" ||
    e.name === "AbortError" ||
    e.code === "ERROR_CEREMONY_ABORTED" ||
    /not allowed|cancel|aborted|timed out/i.test(e.message ?? "")
  );
}

function refusal(
  error: { code?: string; message?: string },
  during: "sign-in" | "set-up" | "list",
): AppError {
  const code = error.code ?? "";
  // A session the server no longer holds: expired, revoked, or wiped. Found in
  // the browser, where it was being reported as "this device couldn't be set
  // up", which sends somebody looking for a fault in their phone.
  if (code === "session_not_found" || code === "bad_jwt" || code === "session_expired") {
    return new AppError(
      "UNAUTHENTICATED",
      "Your session has ended. Sign in again to manage your devices.",
      401,
    );
  }
  if (code === "passkey_disabled") {
    return new AppError(
      "FORBIDDEN",
      "Face and fingerprint sign-in isn't switched on yet. Use an email code for now.",
      403,
    );
  }
  if (code === "webauthn_credential_not_found") {
    return new AppError(
      "NOT_FOUND",
      "Face or fingerprint isn't set up for Neuvto on this device yet. Sign in with an email code, then turn it on in Sign-in and security.",
      404,
    );
  }
  if (code === "webauthn_credential_exists") {
    return new AppError("VALIDATION_FAILED", "This device is already set up.", 400);
  }
  if (code === "too_many_passkeys") {
    return new AppError(
      "VALIDATION_FAILED",
      "You have set up as many devices as an account can hold. Remove one you no longer use first.",
      400,
    );
  }
  if (code === "webauthn_challenge_expired" || code === "webauthn_challenge_not_found") {
    return new AppError("VALIDATION_FAILED", "That took too long. Please try again.", 400);
  }
  if (code === "user_banned") {
    return new AppError("FORBIDDEN", "This account can't sign in.", 403);
  }
  return new AppError(
    "INTERNAL_ERROR",
    during === "sign-in"
      ? "Face or fingerprint sign-in didn't work. Use an email code instead."
      : during === "list"
        ? "Your devices couldn't be loaded. Please try again."
        : "This device couldn't be set up. Please try again.",
    500,
  );
}

/**
 * Signs in with the device's face or fingerprint.
 *
 * Returns false when the person cancelled the prompt, true when signed in, and
 * throws an AppError with a sentence for everything else. No email is asked
 * for: the device knows which account its passkey belongs to.
 */
export async function signInWithFaceOrFingerprint(): Promise<boolean> {
  enablePasskeys();
  let result: Awaited<ReturnType<typeof supabase.auth.signInWithPasskey>>;
  try {
    result = await supabase.auth.signInWithPasskey();
  } catch (e) {
    if (isCancelled(e)) return false;
    throw refusal(e as { code?: string }, "sign-in");
  }
  if (result.error) {
    if (isCancelled(result.error)) return false;
    throw refusal(result.error as { code?: string }, "sign-in");
  }
  return true;
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Adds this device. Requires a signed-in session. False if cancelled. */
export async function registerThisDevice(): Promise<boolean> {
  enablePasskeys();
  let result: Awaited<ReturnType<typeof supabase.auth.registerPasskey>>;
  try {
    result = await supabase.auth.registerPasskey();
  } catch (e) {
    if (isCancelled(e)) return false;
    throw refusal(e as { code?: string }, "set-up");
  }
  if (result.error) {
    if (isCancelled(result.error)) return false;
    throw refusal(result.error as { code?: string }, "set-up");
  }
  return true;
}

export async function listPasskeys(): Promise<Passkey[]> {
  enablePasskeys();
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw refusal(error as { code?: string }, "list");
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.friendly_name || "This device",
    createdAt: p.created_at,
    lastUsedAt: p.last_used_at ?? null,
  }));
}

export async function removePasskey(id: string): Promise<void> {
  enablePasskeys();
  const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "That device couldn't be removed. Please try again.", 500);
  }
}

/** The refusal mapping, exported for its tests. */
export const refusalForTest = refusal;

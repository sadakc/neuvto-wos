/**
 * Email one-time-code sign-in (D8).
 *
 * No passwords anywhere: nothing to phish, forget, reuse, or leak in a dump —
 * and it removes the missing password-reset flow as a problem rather than
 * solving it.
 *
 * Phone OTP is deferred; it needs an SMS provider and Indian DLT template
 * registration. Adding it later means one more function in this file.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";
import { EmailInput, VerifyOtpInput } from "./contracts";

/**
 * Sends a 6-digit code to the address.
 *
 * ── this used to mint an account for anybody who typed into the form
 *
 * The previous version passed `shouldCreateUser: true` unconditionally, under
 * the comment "the same flow serves sign-in and sign-up, so a new person is not
 * told 'no account exists', which would also turn this endpoint into an
 * account-existence oracle."
 *
 * The first half of that stopped being true at D39. There IS no sign-up: a
 * workspace is provisioned, and the only way into one is an invitation. So the
 * flow served sign-in and account-minting-for-strangers, which is not a feature
 * anybody asked for. Typing any address into the sign-in box on the landing
 * page created a real row in `auth.users` and emailed a stranger a code.
 * Verified against a live GoTrue, not inferred: `create_user: true` with an
 * unknown address returns 200 and the row is there afterwards.
 *
 * The second half is a real cost and is now paid deliberately. This endpoint IS
 * an account-existence oracle, because a product with no self-serve signup has
 * nothing useful to say to an unregistered person except that they are not
 * registered. Sada asked for exactly that, 24 Aug 2026.
 *
 * `redeemingInvitation` is the one case that still mints an account, and it has
 * to: `profiles.id` references `auth.users`, so an invited person has no account
 * until their first sign-in. Refusing here would weld shut the only door into a
 * workspace. It defaults to false so that a call site which forgets the flag
 * stops minting accounts rather than starting.
 */
export async function requestOtp(
  input: unknown,
  { redeemingInvitation = false }: { redeemingInvitation?: boolean } = {},
): Promise<void> {
  const { email } = EmailInput.parse(input);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: redeemingInvitation },
  });

  if (!error) return;

  if (error.status === 429) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many codes requested. Wait a minute and try again.",
      429,
    );
  }

  // What GoTrue returns for `create_user: false` against an address it has
  // never seen — confirmed by calling it, because the published error table
  // documents the code without saying which situations produce it:
  //
  //     HTTP 422 {"error_code":"otp_disabled","msg":"Signups not allowed for otp"}
  //
  // ── THE TRAP IN THIS BRANCH
  //
  // `otp_disabled` ALSO means "email OTP is switched off on the server". If
  // that ever happens, every person signing in — including every existing
  // customer — is told they are not registered, and every administrator gets
  // calls about accounts that are demonstrably fine. The `msg` distinguishes
  // the two but is prose and not part of any contract, so it is not branched
  // on. The symptom is recorded in docs/operations/PRODUCTION_HOSTING.md
  // instead: everyone at once means the provider, one person means the person.
  if (isUnknownAddress(error)) {
    throw new AppError(
      "EMAIL_NOT_REGISTERED",
      "Your email address has not been registered. Please contact your administrator.",
      422,
    );
  }

  throw toAppError(error, "requestOtp");
}

/** `code` is the stable field; `status` alone would also catch a bad payload. */
function isUnknownAddress(error: { status?: number; code?: string }): boolean {
  return error.code === "otp_disabled" || error.status === 422;
}

/** Verifies the code and establishes the session. */
export async function verifyOtp(input: unknown): Promise<{ userId: string }> {
  const { email, token } = VerifyOtpInput.parse(input);

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    // Supabase reports a wrong code and an expired code the same way, so the
    // message covers both rather than guessing and being confidently wrong.
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      throw new AppError(
        "OTP_INVALID",
        "That code is not right, or it has expired. Request a new one.",
        401,
      );
    }
    throw toAppError(error, "verifyOtp");
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new AppError("OTP_INVALID", "Sign-in did not complete. Please try again.", 401);
  }
  return { userId };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw toAppError(error, "signOut");
}

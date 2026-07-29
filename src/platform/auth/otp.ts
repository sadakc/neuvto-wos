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
 * `shouldCreateUser: true` is deliberate — the same flow serves sign-in and
 * sign-up, so a new person is not told "no account exists", which would also
 * turn this endpoint into an account-existence oracle.
 */
export async function requestOtp(input: unknown): Promise<void> {
  const { email } = EmailInput.parse(input);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (!error) return;

  if (error.status === 429) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many codes requested. Wait a minute and try again.",
      429,
    );
  }
  throw toAppError(error, "requestOtp");
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

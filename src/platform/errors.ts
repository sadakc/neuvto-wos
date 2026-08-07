/**
 * Typed application errors.
 *
 * Every thrown error carries a stable code from the published taxonomy in
 * docs/standards/NEUVTO_API_STANDARDS.md §6. Codes are never renamed once shipped —
 * callers branch on them.
 *
 * `message` is user-facing and may be rendered verbatim. Write it for an
 * employee, not an engineer.
 */

export const ERROR_CODES = [
  // platform
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "TENANT_MISMATCH",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "MODULE_NOT_ENABLED",
  // approvals — a decision that arrived after somebody else's. Distinct from
  // FORBIDDEN on purpose: nothing is wrong with the person, they are simply
  // looking at a queue that has moved on, and the answer is "refresh", not
  // "you may not".
  "ALREADY_DECIDED",
  // auth
  "OTP_INVALID",
  "OTP_EXPIRED",
  "ALREADY_IN_ORGANIZATION",
  "SLUG_TAKEN",
  "NO_ORGANIZATION",
  // joining a workspace (D39/D40)
  //
  // INVITATION_NOT_FOUND covers expired, revoked, already-used, addressed to
  // somebody else, and never-existed. One code because the database returns one
  // message for all of them: finer distinctions would let a token be probed.
  "INVITATION_NOT_FOUND",
  "EMAIL_IN_ANOTHER_WORKSPACE",
  "ALREADY_A_MEMBER",
  "ALREADY_INVITED",
  "PHONE_ALREADY_A_MEMBER",
  "PHONE_ALREADY_INVITED",
  "INVALID_EMAIL",
  "ORGANIZATION_NAME_REQUIRED",
  // An invitation with no name produces a workspace whose People list, approval
  // timeline and every dropdown fall back to showing email addresses.
  "NAME_REQUIRED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Last-resort conversion for anything that reaches a boundary untyped.
 *
 * Deliberately does NOT pass an unknown error's message through: a raw Postgres
 * or network error can leak schema details, and it reads as gibberish to the
 * person looking at the screen. The real cause is logged instead.
 *
 * This is also where a failed write becomes visible. Every module funnels
 * through here — 28 files as of 4 Aug 2026 — so one call covers the whole
 * surface, and it covers the right half of it: an `AppError` returns above
 * without reporting, because VALIDATION_FAILED or ALREADY_DECIDED is the system
 * working. Only the unknown path is a genuine fault, and only that path is
 * reported. Reporting expected outcomes is how an error store becomes noise
 * nobody reads.
 */
/**
 * Errors that mean "the session ended", which is an outcome and not a fault.
 *
 * Signing out — whether somebody clicked it or the idle timeout did it for them
 * — cancels whatever was in flight. supabase-js reports that as
 * `AuthRefreshDiscardedError` ("session state changed mid-flight (e.g.,
 * concurrent signOut)") or `AuthSessionMissingError`. Both are the library
 * telling us it did the right thing.
 *
 * Reporting these fills the error store with entries that look like an outage
 * and are in fact the sign-out working. The first one arrived on 6 Aug 2026,
 * hours after `jwt_exp` was halved to 1800 — which put token refreshes on
 * roughly the same thirty-minute cadence as the admin idle window, so the two
 * now collide routinely where at 3600 they almost never did.
 *
 * Matched by name first because that is the stable contract; the message check
 * is a fallback for a minified or re-wrapped error whose class is lost, and is
 * kept narrow enough not to swallow a genuine auth failure.
 */
function isSessionEnded(e: unknown): boolean {
  const name = (e as { name?: unknown })?.name;
  if (name === "AuthRefreshDiscardedError" || name === "AuthSessionMissingError") return true;
  const message = (e as { message?: unknown })?.message;
  return typeof message === "string" && message.includes("Refresh result discarded");
}

export function toAppError(e: unknown, context: string): AppError {
  if (isAppError(e)) return e;

  // Before the console.error and before the report: this is the system working,
  // and it belongs with VALIDATION_FAILED and ALREADY_DECIDED rather than with
  // the faults below. UNAUTHENTICATED is already in the taxonomy and is exactly
  // what a caller should branch on — the session is gone, send them to sign in.
  if (isSessionEnded(e)) {
    return new AppError("UNAUTHENTICATED", "Your session has ended. Please sign in again.", 401);
  }

  console.error(`[${context}]`, e);
  // Imported lazily so this module stays importable from server code and tests
  // without dragging in the Supabase client.
  void import("./observability/report")
    .then((m) => m.reportError(e, "write_failed", { context }))
    .catch(() => {});
  return new AppError("INTERNAL_ERROR", "Something went wrong on our end. Please try again.", 500);
}

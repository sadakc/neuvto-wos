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
 */
export function toAppError(e: unknown, context: string): AppError {
  if (isAppError(e)) return e;
  console.error(`[${context}]`, e);
  return new AppError("INTERNAL_ERROR", "Something went wrong on our end. Please try again.", 500);
}

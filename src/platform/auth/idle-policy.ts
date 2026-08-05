/**
 * When a session has run out, expressed as arithmetic.
 *
 * Deliberately pure: no timers, no DOM, no storage, no clock of its own. `now`
 * is a parameter. Everything that decides whether somebody is signed out lives
 * here, so it can be tested at boundaries rather than by waiting half an hour,
 * and `idle.ts` is left holding only plumbing.
 *
 * Same split as `resolveTheme` (src/platform/design/theme.ts) and the script in
 * __root.tsx that runs it: the rule is one testable thing, the machinery that
 * feeds it is another.
 */

export type IdleVerdict = "active" | "warn" | "expired-idle" | "expired-absolute";

export interface IdleInput {
  /** Wall clock, in ms. A parameter so tests need no fake timers. */
  now: number;
  /**
   * Last observed activity, in ms, shared across tabs through localStorage.
   * Null when the key is missing — a fresh session, or somebody who cleared
   * site data.
   */
  lastActivityAt: number | null;
  /**
   * When the session began, from the server (`last_sign_in_at`). Null when it
   * cannot be read, which disables the absolute check rather than guessing.
   */
  sessionStartedAt: number | null;
  idleMinutes: number;
  absoluteHours: number;
  /** How long before expiry to warn. 0 disables the warning. */
  warnSeconds: number;
}

export function decide(input: IdleInput): IdleVerdict {
  const { now, lastActivityAt, sessionStartedAt, idleMinutes, absoluteHours, warnSeconds } = input;

  // A policy that did not load is not a policy of zero. Treating a missing or
  // nonsensical number as "expire immediately" would sign everybody out the
  // moment the RPC had a bad minute — the failure mode where a monitoring
  // outage becomes a user-facing outage.
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return "active";

  // ── absolute first
  //
  // It outranks idle: a session past its hard cap is over regardless of how
  // busy somebody has been, and reporting "idle" for it would be the wrong
  // reason on the screen. Checked only when the start time is known — an
  // unreadable one disables this half rather than inventing a start.
  if (sessionStartedAt !== null && Number.isFinite(absoluteHours) && absoluteHours > 0) {
    const absoluteMs = absoluteHours * 3_600_000;
    // Guard the same clock-skew case as below: a start time in the future means
    // the two clocks disagree, not that the session is ancient.
    if (sessionStartedAt <= now && now - sessionStartedAt >= absoluteMs) {
      return "expired-absolute";
    }
  }

  // ── idle
  //
  // A missing timestamp means "we have not seen you yet", which is the state of
  // every fresh sign-in. Expiring on it would log people out immediately after
  // signing in — the single most likely way this feature ships broken.
  if (lastActivityAt === null) return "active";

  // A future timestamp means another tab's clock is ahead, or the machine's
  // clock moved. Nobody is expired by disagreement between clocks.
  //
  // Belt and braces, and honestly labelled as such: with the arithmetic below,
  // a future timestamp makes `since` negative, and a negative number never
  // exceeds a positive threshold — so removing this line changes no verdict
  // today, and sabotaging it produced no failing test. It stays because the
  // property is worth stating where somebody editing the arithmetic will read
  // it. Wrap `since` in Math.abs one day and this becomes the only thing
  // standing between a skewed clock and an instant sign-out.
  if (lastActivityAt > now) return "active";

  const idleMs = idleMinutes * 60_000;
  const since = now - lastActivityAt;

  if (since >= idleMs) return "expired-idle";

  // `>=` so that a warning window equal to the whole timeout warns from the
  // start rather than never.
  if (warnSeconds > 0 && since >= idleMs - warnSeconds * 1000) return "warn";

  return "active";
}

/** Milliseconds until the idle deadline. Negative once past it. */
export function msUntilIdle(input: Pick<IdleInput, "now" | "lastActivityAt" | "idleMinutes">) {
  if (input.lastActivityAt === null) return input.idleMinutes * 60_000;
  return input.idleMinutes * 60_000 - (input.now - input.lastActivityAt);
}

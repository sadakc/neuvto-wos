import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reportError = vi.fn().mockResolvedValue(undefined);
vi.mock("./observability/report", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { toAppError, AppError, isAppError } from "./errors";

/** `toAppError` reports through a lazy import, so let the microtask run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Shaped like the real thing: supabase-js sets `name` on its error classes. */
function authError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

beforeEach(() => {
  reportError.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A session ending is an outcome, not a fault.
 *
 * On 6 Aug 2026 the idle timeout fired in production for the first time. Its
 * `end()` called `signOut()`, a token refresh already in flight was discarded,
 * and supabase-js raised `AuthRefreshDiscardedError` — which is the library
 * saying it did the right thing. Nobody saw an error; the watcher tolerated it
 * exactly as designed. `client_errors` recorded a crash.
 *
 * It surfaced then because `jwt_exp` had just been halved to 1800, putting
 * refreshes on roughly the same thirty-minute cadence as the admin idle window.
 * At 3600 the two almost never coincided.
 */
describe("a session that ended is not an incident", () => {
  it("maps AuthRefreshDiscardedError to UNAUTHENTICATED", () => {
    const e = authError(
      "AuthRefreshDiscardedError",
      "Refresh result discarded: session state changed mid-flight (e.g., concurrent signOut)",
    );
    const app = toAppError(e, "getSessionStartedAt");
    expect(app.code).toBe("UNAUTHENTICATED");
    expect(app.status).toBe(401);
  });

  it("does NOT report it — this is the whole point", async () => {
    // The assertion that matters. Mapping the code while still reporting would
    // leave the error store exactly as noisy as before and look fixed.
    toAppError(authError("AuthRefreshDiscardedError", "Refresh result discarded: whatever"), "x");
    await settle();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("maps AuthSessionMissingError too", () => {
    expect(
      toAppError(authError("AuthSessionMissingError", "Auth session missing!"), "x").code,
    ).toBe("UNAUTHENTICATED");
  });

  it("recognises it by message when the class name is lost", async () => {
    // Minification, a re-wrap, or an error crossing a worker boundary can drop
    // the class. The message is the fallback.
    const bare = new Error("Refresh result discarded: session state changed mid-flight");
    expect(toAppError(bare, "x").code).toBe("UNAUTHENTICATED");
    await settle();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("says something a person can act on", () => {
    const app = toAppError(authError("AuthSessionMissingError", "Auth session missing!"), "x");
    expect(app.message).toMatch(/sign in again/i);
    // Never the raw library text — it names internals and reads as gibberish.
    expect(app.message).not.toContain("mid-flight");
  });
});

/**
 * Non-vacuity. Every assertion above would also pass if `toAppError` had simply
 * stopped reporting anything, which would be a far worse bug than the one being
 * fixed — a silent error store looks identical to a healthy one.
 */
describe("a genuine fault is still a fault", () => {
  it("becomes INTERNAL_ERROR and IS reported", async () => {
    const app = toAppError(new Error("column balance does not exist"), "leaveApply");
    expect(app.code).toBe("INTERNAL_ERROR");
    expect(app.status).toBe(500);
    await settle();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("does not leak the raw cause to the screen", async () => {
    // A Postgres error names columns and constraints; that is schema disclosure
    // and it reads as gibberish to whoever is looking at the page.
    const app = toAppError(new Error('relation "leave_balances" does not exist'), "x");
    expect(app.message).not.toContain("leave_balances");
    await settle();
  });

  it("an auth error that is NOT a session ending is still reported", async () => {
    // The guard must not swallow real auth failures — a bad grant, a broken
    // policy, an expired key all arrive as auth-shaped errors and all matter.
    const app = toAppError(authError("AuthApiError", "Invalid API key"), "x");
    expect(app.code).toBe("INTERNAL_ERROR");
    await settle();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("passes an AppError through untouched and unreported", async () => {
    const original = new AppError("VALIDATION_FAILED", "Pick a date.", 400);
    const out = toAppError(original, "x");
    expect(out).toBe(original);
    expect(isAppError(out)).toBe(true);
    await settle();
    expect(reportError).not.toHaveBeenCalled();
  });
});

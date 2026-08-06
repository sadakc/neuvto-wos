import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

const reportError = vi.fn().mockResolvedValue(undefined);
vi.mock("@/platform/observability/report", () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

import { getSessionStartedAt } from "./session";

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  getSession.mockReset();
  reportError.mockClear();
});

/**
 * `getSessionStartedAt` is the absolute-timeout clock, and its contract — stated
 * in `IdleInput.sessionStartedAt` and honoured by `decide()` — is "null when it
 * cannot be read, which disables the absolute check rather than guessing".
 *
 * It used to throw `toAppError` instead, which contradicted that contract in a
 * way nothing could see: its only caller writes `.catch(() => null)` and so
 * tolerated the throw exactly as intended — but `toAppError` REPORTS before it
 * throws, so a deliberately-tolerated outcome still landed in `client_errors`
 * as an application fault. That is the entry recorded on 6 Aug 2026 at 08:05,
 * when the idle timeout fired in production for the first time and discarded a
 * token refresh on its way out.
 */
describe("getSessionStartedAt — the clock that must never raise", () => {
  it("returns the session start when it can be read", async () => {
    const iso = "2026-08-06T04:00:00.000Z";
    getSession.mockResolvedValue({ data: { session: { user: { last_sign_in_at: iso } } } });
    await expect(getSessionStartedAt()).resolves.toBe(Date.parse(iso));
  });

  it("returns null when supabase reports an error, and reports nothing", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: new Error("network down") });
    await expect(getSessionStartedAt()).resolves.toBeNull();
    await settle();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null when getSession REJECTS — the sign-out race", async () => {
    // The actual 6 Aug case. signOut() cancels an in-flight refresh and
    // supabase-js raises rather than resolving with an error field, so the
    // `error` branch above never runs.
    const e = new Error("Refresh result discarded: session state changed mid-flight");
    e.name = "AuthRefreshDiscardedError";
    getSession.mockRejectedValue(e);
    await expect(getSessionStartedAt()).resolves.toBeNull();
    await settle();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null when signed out, which is not an error at all", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(getSessionStartedAt()).resolves.toBeNull();
  });

  it("returns null for an unparseable timestamp rather than NaN", async () => {
    // NaN would flow into `decide()` and make every comparison false, silently
    // disabling the absolute cap while looking like a real number.
    getSession.mockResolvedValue({
      data: { session: { user: { last_sign_in_at: "not a date" } } },
    });
    await expect(getSessionStartedAt()).resolves.toBeNull();
  });
});

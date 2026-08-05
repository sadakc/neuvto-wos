// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  authCallback: null as null | ((event: string, session: unknown) => void),
  session: { user: { last_sign_in_at: new Date().toISOString() } } as unknown,
  unsubscribe: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        h.authCallback = cb;
        return { data: { subscription: { unsubscribe: h.unsubscribe } } };
      },
      getSession: async () => ({ data: { session: h.session } }),
    },
  },
}));

vi.mock("@/platform/navigate", () => ({ hardNavigate: vi.fn() }));
vi.mock("./otp", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./session", () => ({ getSessionStartedAt: vi.fn().mockResolvedValue(Date.now()) }));
vi.mock("./session-policy", () => ({
  getSessionPolicy: vi.fn().mockResolvedValue({ idleMinutes: 30, absoluteHours: 24 }),
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

import { installIdleWatcher } from "./idle";
import { hardNavigate } from "@/platform/navigate";
import { signOut } from "./otp";
import { getSessionStartedAt } from "./session";
import { toast } from "sonner";

const navigate = vi.mocked(hardNavigate);
const out = vi.mocked(signOut);
const ACTIVITY = "neuvto.session.lastActivityAt";
const ENDED = "neuvto.session.endedReason";
const MIN = 60_000;

/** Advance the clock AND let the async tick settle. */
async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

let teardown: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-05T09:00:00Z"));
  navigate.mockClear();
  out.mockClear();
  vi.mocked(toast.warning).mockClear();
  vi.mocked(getSessionStartedAt).mockResolvedValue(Date.now());
  h.authCallback = null;
  h.session = { user: { last_sign_in_at: new Date().toISOString() } };
  localStorage.clear();
  window.history.replaceState({}, "", "/app/leave");
});

afterEach(() => {
  teardown?.();
  teardown = null;
  vi.useRealTimers();
});

/** Install and let the getSession() promise arm it. */
async function install() {
  teardown = installIdleWatcher();
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  return teardown;
}

describe("signing somebody out after inactivity", () => {
  it("signs out once past the deadline, and says why", async () => {
    await install();
    await advance(31 * MIN);
    expect(out).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("reason=idle"));
  });

  it("does not sign out inside the window", async () => {
    await install();
    await advance(20 * MIN);
    expect(out).not.toHaveBeenCalled();
  });

  it("returns the person to where they were, without the query string", async () => {
    // `next` is good manners. The query string is where an invitation token
    // lives, and carrying a credential through a security event is not.
    window.history.replaceState({}, "", "/app/leave/apply?token=live-secret");
    await install();
    await advance(31 * MIN);
    const url = navigate.mock.calls[0][0];
    expect(url).toContain("next=");
    expect(url).toContain(encodeURIComponent("/app/leave/apply"));
    expect(url).not.toContain("live-secret");
  });

  it("signs out on the absolute cap even while somebody is active", async () => {
    vi.mocked(getSessionStartedAt).mockResolvedValue(Date.now() - 25 * 3_600_000);
    await install();
    // Activity right now — only the absolute cap can end this.
    localStorage.setItem(ACTIVITY, String(Date.now()));
    await advance(20_000);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("reason=absolute"));
  });

  it("signs out exactly once, however many ticks pass", async () => {
    await install();
    await advance(60 * MIN);
    expect(out).toHaveBeenCalledTimes(1);
  });
});

describe("more than one tab", () => {
  it("stays signed in when another tab is being used", async () => {
    // THE reason every tick re-reads localStorage instead of trusting its own
    // memory of the last keystroke. A single-tab test passes either way.
    await install();
    for (let i = 0; i < 6; i++) {
      await advance(5 * MIN);
      // Another tab reports activity.
      localStorage.setItem(ACTIVITY, String(Date.now()));
      window.dispatchEvent(new StorageEvent("storage", { key: ACTIVITY }));
    }
    expect(out).not.toHaveBeenCalled();
  });

  it("follows another tab that has already ended the session", async () => {
    await install();
    window.dispatchEvent(new StorageEvent("storage", { key: ENDED, newValue: "idle" }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("reason=idle"));
  });

  it("does not sign out twice when two watchers are installed", async () => {
    await install();
    const second = installIdleWatcher();
    await vi.advanceTimersByTimeAsync(0);
    await advance(31 * MIN);
    expect(out).toHaveBeenCalledTimes(1);
    second();
  });
});

describe("arming and disarming", () => {
  it("does not run on the sign-in page", async () => {
    // Expiring somebody mid-sign-in and redirecting them to sign in is a loop.
    window.history.replaceState({}, "", "/auth");
    await install();
    await advance(60 * MIN);
    expect(out).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clears a stale timestamp on sign-in, so a fresh session is not expired at once", async () => {
    // The likeliest way this ships broken: a leftover key from an hour ago,
    // read on the first tick after signing in.
    //
    // Pins the PROPERTY. Today `arm()`'s seeding provides it, not the
    // clearKeys() call on SIGNED_IN — removing that clear fails nothing, which
    // was checked rather than assumed. The assertion still earns its place: it
    // is what catches somebody removing the seed from arm().
    localStorage.setItem(ACTIVITY, String(Date.now() - 5 * 3_600_000));
    await install();
    h.authCallback?.("SIGNED_IN", h.session);
    await advance(20_000);
    expect(out).not.toHaveBeenCalled();
  });

  it("stops watching once signed out", async () => {
    await install();
    h.authCallback?.("SIGNED_OUT", null);
    await advance(60 * MIN);
    expect(out).not.toHaveBeenCalled();
  });

  it("removes every listener and the interval on teardown", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const t = await install();
    t();
    teardown = null;
    const removed = remove.mock.calls.map((c) => c[0]);
    for (const ev of ["pointerdown", "keydown", "scroll", "focus", "storage"]) {
      expect(removed).toContain(ev);
    }
    expect(h.unsubscribe).toHaveBeenCalled();
    await advance(60 * MIN);
    expect(out).not.toHaveBeenCalled();
  });
});

describe("the warning", () => {
  it("warns before signing out, not after", async () => {
    await install();
    await advance(29 * MIN + 30_000);
    expect(toast.warning).toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
  });

  it("does not warn in a background tab", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await install();
    await advance(29 * MIN + 30_000);
    expect(toast.warning).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("warns once, not on every tick", async () => {
    await install();
    await advance(29 * MIN + 30_000);
    await advance(15_000);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from "vitest";
import { decide, msUntilIdle, type IdleInput } from "./idle-policy";

/**
 * No DOM and no fake timers — `now` is a parameter, which is the whole reason
 * this module is separate from the watcher that drives it.
 */

const T = 1_700_000_000_000; // an arbitrary fixed "now"
const MIN = 60_000;
const HOUR = 3_600_000;

const base: IdleInput = {
  now: T,
  lastActivityAt: T,
  sessionStartedAt: T,
  idleMinutes: 30,
  absoluteHours: 24,
  warnSeconds: 60,
};

const at = (over: Partial<IdleInput>) => decide({ ...base, ...over });

describe("idle expiry, at the boundary", () => {
  it("is active one millisecond before the deadline", () => {
    expect(at({ lastActivityAt: T - 30 * MIN + 1 })).not.toBe("expired-idle");
  });

  it("is expired exactly ON the deadline", () => {
    // `>=` not `>`. A timer that fires at exactly 30:00 must expire, or the
    // stated policy is "thirty minutes and one tick".
    expect(at({ lastActivityAt: T - 30 * MIN })).toBe("expired-idle");
  });

  it("is expired well past it", () => {
    expect(at({ lastActivityAt: T - 5 * HOUR })).toBe("expired-idle");
  });

  it("honours a longer policy — an employee's eight hours", () => {
    const employee = { idleMinutes: 480 };
    expect(at({ ...employee, lastActivityAt: T - 7 * HOUR })).toBe("active");
    expect(at({ ...employee, lastActivityAt: T - 8 * HOUR })).toBe("expired-idle");
  });
});

describe("the absolute cap is independent of activity", () => {
  it("expires a session past its cap even when somebody is typing right now", () => {
    // The case an idle-only timeout misses entirely: a laptop left open with
    // something jiggling the mouse.
    expect(at({ lastActivityAt: T, sessionStartedAt: T - 25 * HOUR })).toBe("expired-absolute");
  });

  it("outranks idle, so the screen gives the right reason", () => {
    expect(at({ lastActivityAt: T - 5 * HOUR, sessionStartedAt: T - 25 * HOUR })).toBe(
      "expired-absolute",
    );
  });

  it("is active one millisecond before the cap", () => {
    expect(at({ sessionStartedAt: T - 24 * HOUR + 1 })).toBe("active");
  });

  it("applies the tighter staff cap", () => {
    expect(at({ absoluteHours: 8, sessionStartedAt: T - 9 * HOUR })).toBe("expired-absolute");
    expect(at({ absoluteHours: 8, sessionStartedAt: T - 7 * HOUR })).toBe("active");
  });

  it("is disabled, not guessed, when the start time cannot be read", () => {
    expect(at({ sessionStartedAt: null, lastActivityAt: T })).toBe("active");
  });
});

describe("the warning window", () => {
  it("warns inside it", () => {
    expect(at({ lastActivityAt: T - 30 * MIN + 30_000 })).toBe("warn");
  });

  it("does not warn before it", () => {
    expect(at({ lastActivityAt: T - 20 * MIN })).toBe("active");
  });

  it("expires rather than warning once past the deadline", () => {
    expect(at({ lastActivityAt: T - 31 * MIN })).toBe("expired-idle");
  });

  it("can be switched off", () => {
    expect(at({ warnSeconds: 0, lastActivityAt: T - 30 * MIN + 30_000 })).toBe("active");
  });
});

describe("what must never expire anybody", () => {
  it("a missing activity timestamp — every fresh sign-in looks like this", () => {
    // The likeliest way this feature ships broken: treat "no key yet" as
    // "infinitely idle" and everybody is signed out the moment they sign in.
    expect(at({ lastActivityAt: null })).toBe("active");
  });

  it("a timestamp in the future — two clocks disagreeing, not an old session", () => {
    // Pins the PROPERTY, not the guard that provides it. Today the arithmetic
    // gives this for free (a negative `since` never exceeds a positive
    // threshold) and deleting the explicit guard fails nothing — checked.
    // The assertion still earns its place: it is what would catch somebody
    // making `since` an absolute value.
    expect(at({ lastActivityAt: T + 10 * MIN })).toBe("active");
  });

  it("a session start in the future", () => {
    expect(at({ sessionStartedAt: T + HOUR })).toBe("active");
  });

  it("a policy that failed to load", () => {
    // A monitoring outage must not become a user-facing outage.
    expect(at({ idleMinutes: 0 })).toBe("active");
    expect(at({ idleMinutes: Number.NaN })).toBe("active");
    expect(at({ idleMinutes: -5 })).toBe("active");
  });

  it("an unreadable absolute cap", () => {
    expect(at({ absoluteHours: Number.NaN, sessionStartedAt: T - 100 * HOUR })).toBe("active");
    expect(at({ absoluteHours: 0, sessionStartedAt: T - 100 * HOUR })).toBe("active");
  });
});

describe("msUntilIdle", () => {
  it("counts down", () => {
    expect(msUntilIdle({ now: T, lastActivityAt: T - 10 * MIN, idleMinutes: 30 })).toBe(20 * MIN);
  });

  it("goes negative past the deadline", () => {
    expect(msUntilIdle({ now: T, lastActivityAt: T - 31 * MIN, idleMinutes: 30 })).toBeLessThan(0);
  });

  it("gives a full window when nothing has been recorded", () => {
    expect(msUntilIdle({ now: T, lastActivityAt: null, idleMinutes: 30 })).toBe(30 * MIN);
  });
});

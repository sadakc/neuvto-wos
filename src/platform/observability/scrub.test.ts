import { describe, it, expect } from "vitest";
import { scrubText, sanitizeRoute, fingerprint, messageOf, MAX_MESSAGE, MAX_STACK } from "./scrub";

/**
 * These tests are the reason the scrubber can be trusted at all. Each one was
 * watched failing — the pattern it covers removed, the test run, the leak
 * observed in the output — before it was kept.
 */

describe("scrubText — what must never reach the database", () => {
  it("removes email addresses, which are how an employee is named", () => {
    expect(scrubText("Cannot read balance for priya.sharma@customer.test")).toBe(
      "Cannot read balance for [address]",
    );
  });

  it("removes every address in a line, not just the first", () => {
    // A `.replace` without the global flag passes the single-address test above
    // and leaks every subsequent one.
    const out = scrubText("from a@b.test to c@d.test cc e@f.test");
    expect(out).toBe("from [address] to [address] cc [address]");
    expect(out).not.toMatch(/@/);
  });

  it("removes phone numbers beyond +91, so going global is not a leak", () => {
    expect(scrubText("failed for +919663333364")).toBe("failed for [number]");
    expect(scrubText("failed for +14155552671")).toBe("failed for [number]");
    expect(scrubText("failed for +44 7700 900123")).toBe("failed for [number]");
  });

  it("removes uuids, because every id here identifies a person or their org", () => {
    expect(scrubText("employee 3f2a4b6c-1d2e-4f3a-8b9c-0d1e2f3a4b5c missing")).toBe(
      "employee [id] missing",
    );
  });

  it("removes bearer tokens and publishable keys", () => {
    expect(scrubText("Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toContain("[token]");
    expect(scrubText("key sb_publishable_abc123DEF")).toContain("[token]");
  });

  it("removes long digit runs that are not phone numbers", () => {
    expect(scrubText("employee number 88123456 not found")).toBe(
      "employee number [digits] not found",
    );
  });

  it("keeps line and column numbers, which are the useful part of a trace", () => {
    // The digit rule is bounded at 7+ precisely so it cannot eat these.
    expect(scrubText("at Foo (index.tsx:42:11)")).toBe("at Foo (index.tsx:42:11)");
  });

  it("survives null, undefined and empty input without throwing", () => {
    // A scrubber that throws inside an error handler turns one broken page into
    // two, and the second one has no handler left.
    expect(scrubText(null)).toBe("");
    expect(scrubText(undefined)).toBe("");
    expect(scrubText("")).toBe("");
  });
});

describe("sanitizeRoute — the query string is a credential", () => {
  it("drops the query string entirely", () => {
    // An invitation is accepted at a URL carrying a live token. An error on that
    // page must not write the token into a table where it sits until it expires.
    expect(sanitizeRoute("/auth/accept?token=abc123secret&org=neuvto")).toBe("/auth/accept");
  });

  it("drops the fragment, where implicit-flow tokens live", () => {
    expect(sanitizeRoute("/auth#access_token=eyJhbGciOi")).toBe("/auth");
  });

  it("replaces uuid segments with :id, which both groups and anonymises", () => {
    expect(sanitizeRoute("/app/leave/3f2a4b6c-1d2e-4f3a-8b9c-0d1e2f3a4b5c")).toBe("/app/leave/:id");
  });

  it("groups two different employees' pages as one route", () => {
    const a = sanitizeRoute("/app/people/3f2a4b6c-1d2e-4f3a-8b9c-0d1e2f3a4b5c");
    const b = sanitizeRoute("/app/people/99999999-8888-4777-a666-555544443333");
    expect(a).toBe(b);
  });

  it("replaces numeric segments", () => {
    expect(sanitizeRoute("/app/reports/2026")).toBe("/app/reports/:n");
  });

  it("falls back to / rather than empty", () => {
    expect(sanitizeRoute("")).toBe("/");
    expect(sanitizeRoute(null)).toBe("/");
    expect(sanitizeRoute("?only=query")).toBe("/");
  });
});

describe("fingerprint — one fault, one group", () => {
  it("groups two occurrences that differ only by an id", () => {
    const a = fingerprint("Cannot read balance for 3f2a4b6c-1d2e-4f3a-8b9c-0d1e2f3a4b5c");
    const b = fingerprint("Cannot read balance for 99999999-8888-4777-a666-555544443333");
    expect(a).toBe(b);
  });

  it("groups across a rebuild, when only the chunk hash changed", () => {
    // Otherwise every deploy re-groups every open fault and no error can be
    // tracked across a release — which is most of what an error store is for.
    const a = fingerprint("boom", "Error: boom\n  at Foo (/assets/apply-B7xK2p.tsx:4:9)");
    const b = fingerprint("boom", "Error: boom\n  at Foo (/assets/apply-Zq91mE.tsx:4:9)");
    expect(a).toBe(b);
  });

  it("does NOT group two genuinely different faults", () => {
    expect(fingerprint("balance is negative")).not.toBe(fingerprint("approver unresolved"));
  });

  it("groups by our own frame, not by the framework that surfaced it", () => {
    // If the first frame wins regardless, every unrelated fault in the app
    // collapses into one giant react-dom group and the store is useless.
    const stack = [
      "Error: boom",
      "  at commitHookEffectListMount (/assets/node_modules/react-dom/client.js:1:1)",
      "  at ApplyLeave (/assets/ApplyLeave.tsx:88:12)",
    ].join("\n");
    expect(fingerprint("boom", stack)).toContain("applyleave.tsx");
    expect(fingerprint("boom", stack)).not.toContain("client.js");
  });

  it("scrubs before fingerprinting, so no address survives in the key", () => {
    expect(fingerprint("failed for priya@customer.test")).not.toContain("@");
  });

  it("copes with no stack at all", () => {
    expect(fingerprint("boom")).toBe("boom");
  });
});

describe("messageOf — turning a thrown anything into something groupable", () => {
  it("reads a thrown Response instead of stringifying it to [object Response]", () => {
    // Loaders and server fns throw raw Responses. Without this every HTTP
    // failure in the app groups into one meaningless bucket.
    const r = new Response(null, { status: 503 });
    Object.defineProperty(r, "url", { value: "https://neuvto.com/api/leave?token=secret" });
    const out = messageOf(r);
    expect(out).toContain("503");
    expect(out).not.toContain("token=secret");
  });

  it("prefers an Error's message", () => {
    expect(messageOf(new Error("balance is negative"))).toBe("balance is negative");
  });

  it("falls back to the name when an Error has no message", () => {
    expect(messageOf(new TypeError())).toBe("TypeError");
  });

  it("handles strings and objects thrown directly", () => {
    expect(messageOf("plain string")).toBe("plain string");
    expect(messageOf({ code: "P0001" })).toContain("P0001");
  });

  it("does not throw on a value that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => messageOf(circular)).not.toThrow();
  });
});

describe("limits agree with the database", () => {
  it("matches the truncation in record_client_error", () => {
    // If these drift, the client sends more than the database keeps and the
    // stack is silently cut mid-frame.
    expect(MAX_MESSAGE).toBe(500);
    expect(MAX_STACK).toBe(4000);
  });
});

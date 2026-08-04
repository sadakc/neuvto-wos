// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/lib/lovable-error-reporting", () => ({ reportLovableError: vi.fn() }));

import { reportError, installGlobalErrorHandlers, resetReportingStateForTests } from "./report";

const argsOf = (call: number) => rpc.mock.calls[call][1] as Record<string, unknown>;

beforeEach(() => {
  rpc.mockClear();
  rpc.mockResolvedValue({ data: null, error: null });
  resetReportingStateForTests();
});

describe("reportError — what actually leaves the browser", () => {
  it("calls record_client_error with a fingerprint, message and route", async () => {
    await reportError(new Error("balance is negative"), "boundary");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("record_client_error");
    const a = argsOf(0);
    expect(a.p_message).toBe("balance is negative");
    expect(a.p_mechanism).toBe("boundary");
    expect(a.p_fingerprint).toBeTruthy();
  });

  it("scrubs before sending, so PII never reaches the network", async () => {
    // The database scrubs too, but this is the pass that keeps an employee's
    // address out of the request body in the first place.
    await reportError(new Error("no balance for priya@customer.test on +919663333364"), "boundary");
    const a = argsOf(0);
    expect(a.p_message).not.toContain("@customer.test");
    expect(a.p_message).not.toContain("9663333364");
    expect(a.p_message).toContain("[address]");
  });

  it("sends the sanitised route, never the query string", async () => {
    window.history.replaceState({}, "", "/auth/accept?token=live-secret-token");
    await reportError(new Error("boom"), "boundary");
    const a = argsOf(0);
    expect(a.p_route).toBe("/auth/accept");
    expect(JSON.stringify(a)).not.toContain("live-secret-token");
  });
});

describe("the guards that stop reporting becoming the incident", () => {
  it("sends the same fault only once per page load", async () => {
    // The database would collapse these into one row anyway. The point of this
    // guard is the thousands of requests a render loop would otherwise issue.
    for (let i = 0; i < 50; i++) await reportError(new Error("same fault"), "boundary");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("still reports genuinely different faults", async () => {
    await reportError(new Error("first fault"), "boundary");
    await reportError(new Error("second fault"), "boundary");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("stops after 20 distinct faults in one page load", async () => {
    // NOT `fault ${i}` — the fingerprint flattens digits to `#` on purpose, so
    // forty numbered messages are one group and this would silently test the
    // dedupe again rather than the cap. The first version of this test did
    // exactly that and passed at 1 call.
    const word = (i: number) => `fault ${String.fromCharCode(97 + (i % 26))}${"x".repeat(i)}`;
    for (let i = 0; i < 40; i++) await reportError(new Error(word(i)), "boundary");
    expect(rpc).toHaveBeenCalledTimes(20);
  });

  it("does not report a failure that happened while reporting", async () => {
    // Without the recursion guard: the RPC rejects, the rejection reaches the
    // global handler, which reports it, which rejects... until the tab dies.
    rpc.mockImplementation(async () => {
      await reportError(new Error("failure caused by the reporter"), "unhandledrejection");
      return { data: null, error: null };
    });
    await reportError(new Error("original fault"), "boundary");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("never throws when the RPC itself fails", async () => {
    // Offline, expired session, endpoint down. An error handler that can fail
    // visibly is not an error handler.
    rpc.mockRejectedValue(new Error("network down"));
    await expect(reportError(new Error("boom"), "boundary")).resolves.toBeUndefined();
  });

  it("recovers after a failed report instead of latching shut", async () => {
    // If `reporting` were not reset in a finally, one network blip would
    // silently disable reporting for the rest of the session.
    rpc.mockRejectedValueOnce(new Error("network down"));
    await reportError(new Error("first"), "boundary");
    rpc.mockResolvedValue({ data: null, error: null });
    await reportError(new Error("second"), "boundary");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("installGlobalErrorHandlers — what a boundary never sees", () => {
  it("reports an unhandled rejection", async () => {
    const teardown = installGlobalErrorHandlers();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("unawaited promise") }),
    );
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(argsOf(0).p_mechanism).toBe("unhandledrejection");
    teardown();
  });

  it("reports a window error, which a render boundary cannot catch", async () => {
    const teardown = installGlobalErrorHandlers();
    window.dispatchEvent(
      Object.assign(new Event("error"), { error: new Error("thrown in a click handler") }),
    );
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(argsOf(0).p_mechanism).toBe("onerror");
    teardown();
  });

  it("stops reporting once torn down", async () => {
    const teardown = installGlobalErrorHandlers();
    teardown();
    window.dispatchEvent(Object.assign(new Event("error"), { error: new Error("after teardown") }));
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).not.toHaveBeenCalled();
  });
});

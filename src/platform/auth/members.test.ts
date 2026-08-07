/**
 * The translation layer between a Postgres refusal and a sentence.
 *
 * `members.test.tsx` proves those sentences reach the screen — but it mocks
 * `@/platform/auth` wholesale, so the mapping that PRODUCES them is not under
 * test there, and the strings are copied into that file by hand. If the wording
 * in `members.ts` drifted, every render test would keep passing.
 *
 * That is precisely the shape of the bug this project shipped on 7 Aug 2026:
 * `leaveErrorMessage` was tested by handing it the string `toLeaveError` never
 * gave it, so the mapping was proved and the path to it was not. Here it is the
 * other way round — the path is proved and the mapping was not. Both halves are
 * only safe when both are asserted.
 *
 * So these tests start at the exported function with the database mocked, and
 * assert on the code AND the sentence. They are deliberately the only place
 * those sentences are written down as expectations.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  /** What the next rpc() hands back, shaped as supabase-js shapes it. */
  error: null as { message: string } | null,
  data: null as unknown,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: calls.data, error: calls.error }),
  },
}));

const { setReportingLine, deactivateMember } = await import("./members");

beforeEach(() => {
  calls.error = null;
  calls.data = null;
});

/** Runs the call and returns whatever it threw, or null if it did not throw. */
async function refusal(run: () => Promise<unknown>) {
  return await run().then(
    () => null,
    (e: unknown) => e as { code: string; message: string },
  );
}

describe("setReportingLine — D57", () => {
  it("turns MANAGER_CANNOT_APPROVE into the decision the admin has to make", async () => {
    calls.error = { message: "MANAGER_CANNOT_APPROVE" };
    const e = await refusal(() => setReportingLine("emp", "mgr"));

    expect(e?.code).toBe("MANAGER_CANNOT_APPROVE");
    // Sada's own framing: "let the admin decide that they are the managers."
    // The message names the way out, because a refusal that only refuses leaves
    // somebody guessing which of six roles is the right one.
    expect(e?.message).toBe(
      "An Employee can't have people reporting to them, because leave is approved by whoever somebody reports to. Give them the Manager, Supervisor or Coordinator role first.",
    );
  });

  it("still tells a cycle apart from a role", async () => {
    // Both refusals come from the same function and mean entirely different
    // things. The role guard runs first now, so this asserts the older one did
    // not get shadowed.
    calls.error = { message: "REPORTING_CYCLE" };
    const e = await refusal(() => setReportingLine("emp", "mgr"));
    expect(e?.message).toMatch(/report to each other/i);
    expect(e?.code).not.toBe("MANAGER_CANNOT_APPROVE");
  });

  it("does not throw when the database is happy", async () => {
    await expect(setReportingLine("emp", null)).resolves.toBeUndefined();
  });
});

describe("deactivateMember — D57", () => {
  it("turns SUCCESSOR_CANNOT_APPROVE into who to choose instead", async () => {
    calls.error = { message: "SUCCESSOR_CANNOT_APPROVE" };
    const e = await refusal(() => deactivateMember("leaver", "successor"));

    expect(e?.code).toBe("MANAGER_CANNOT_APPROVE");
    expect(e?.message).toBe(
      "This person's reports and approvals have to go to somebody who can approve leave. Choose a manager, supervisor, coordinator or administrator.",
    );
  });

  it("keeps the successor-is-requester refusal distinct", async () => {
    // Two ways to pick the wrong successor, with different fixes: this one is
    // "choose somebody else", the other is "promote them". Collapsing them into
    // one sentence would send an administrator down the wrong path.
    calls.error = { message: "SUCCESSOR_IS_REQUESTER" };
    const e = await refusal(() => deactivateMember("leaver", "successor"));
    expect(e?.message).toMatch(/request of their own/i);
  });
});

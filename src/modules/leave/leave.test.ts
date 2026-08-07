/**
 * The read that has to narrow what RLS deliberately leaves wide.
 *
 * `read leave requests in scope` returns own OR direct reports OR requests you
 * are an approver on OR — for an admin — every one in the organisation. That is
 * correct: it is scoped for TENANCY. It is not scoped for a screen called
 * "My leave".
 *
 * `getMyRequests` leaned on that policy and so listed other people's leave.
 * Found by opening the app as Dan Director, who has no leave at all and was
 * shown a colleague's four approved days as his own — on My Leave, on the
 * dashboard's "next leave", and on his personal calendar, all three of which
 * read through this one function. Present since step 7; invisible until step 10
 * produced an approved request for anyone to see. An administrator would have
 * been shown the whole company's leave as their own.
 *
 * The test asserts the filter is sent, because that is the whole of the fix and
 * the next person to read the "trust RLS, don't filter in application code"
 * comment elsewhere in this module will be tempted to remove it again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { leaveErrorMessage, LeaveTypeInput } from "./contracts";

const calls = vi.hoisted(() => ({
  eq: [] as [string, unknown][],
  uid: "ravi" as string | null,
  /** What PostgREST hands back for the next rpc() — exactly as supabase-js shapes it. */
  rpcError: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return builder;
    },
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      rpc: () => Promise.resolve({ data: null, error: calls.rpcError }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: calls.uid ? { id: calls.uid } : null } }),
      },
    },
  };
});

const { getMyRequests, submitLeave } = await import("./handlers");

beforeEach(() => {
  calls.eq = [];
  calls.uid = "ravi";
  calls.rpcError = null;
});

describe("getMyRequests", () => {
  it("asks for the caller's own rows rather than everything the policy allows", async () => {
    await getMyRequests();
    expect(calls.eq).toContainEqual(["employee_id", "ravi"]);
  });

  it("returns nothing rather than everything when there is no session", async () => {
    // The dangerous failure mode: no uid, no filter, and a query that then
    // returns whatever RLS permits. Empty is the only safe answer.
    calls.uid = null;
    expect(await getMyRequests()).toEqual([]);
    expect(calls.eq).toEqual([]);
  });
});

describe("leaveErrorMessage — INSUFFICIENT_NOTICE", () => {
  // The number comes back from leave_submit because it is the one that was
  // actually enforced: v_notice resolves the leave type's own min_notice_days
  // and falls back to the organisation's default, so a type inheriting the
  // default would be described wrongly by anything read off the form.
  it("says how many days were needed", () => {
    expect(leaveErrorMessage("INSUFFICIENT_NOTICE: 5 days required")).toBe(
      "This leave type needs at least 5 days of notice before you apply.",
    );
  });

  it("says day, not days, for one", () => {
    // Postgres formats the raise with a bare %, so the code always reads
    // "1 days required". Fixing that in the message is this function's job.
    expect(leaveErrorMessage("INSUFFICIENT_NOTICE: 1 days required")).toBe(
      "This leave type needs at least 1 day of notice before you apply.",
    );
  });

  it("falls back when the number is missing", () => {
    // A database that has not had the migration applied still raises the bare
    // code, and a released UI has to survive meeting one.
    expect(leaveErrorMessage("INSUFFICIENT_NOTICE")).toBe(
      "This leave type needs more notice than that.",
    );
  });
});

/**
 * The same refusals, through the path an employee actually takes.
 *
 * The block above tests `leaveErrorMessage` by handing it the full string —
 * which is the one string `toLeaveError` never gave it. `toLeaveError` stripped
 * everything up to the first colon, so the two codes that carry a number were
 * the two codes whose names were thrown away, and both landed on "That didn't
 * work. Please try again."
 *
 * Sada met it on 7 Aug 2026: Casual Leave set to one day's notice, applied for
 * the same day, and was told nothing about notice at all. INSUFFICIENT_BALANCE
 * had been broken the same way since it was written and nobody had reached it.
 *
 * So these tests start at `submitLeave` and assert on the sentence, because the
 * defect lived in the two lines between the mapper and the screen and a test of
 * either end alone cannot see it.
 */
describe("submitLeave — what the employee is actually shown", () => {
  const request = {
    leaveTypeId: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607",
    fromDate: "2026-08-07",
    toDate: "2026-08-07",
  };

  const refusal = async (message: string) => {
    calls.rpcError = { message };
    return await submitLeave(request).then(
      () => null,
      (e: unknown) => e as { message: string; code: string; details?: { code?: string } },
    );
  };

  it("names the notice rule, and says how many days it wanted", async () => {
    const e = await refusal("INSUFFICIENT_NOTICE: 1 days required");
    expect(e?.message).toBe("This leave type needs at least 1 day of notice before you apply.");
  });

  it("says what was asked for and what was left", async () => {
    // Never once reached a screen. Same line, same cause, and the more common
    // of the two — an employee runs out of days far more often than they
    // mistime a request.
    const e = await refusal("INSUFFICIENT_BALANCE: requested 3, available 1");
    expect(e?.message).toBe("You asked for 3 days but have 1 available.");
  });

  it("still reads a code that carries no number", async () => {
    // These were never broken: with no colon there was nothing for the regex to
    // strip. Kept so a future change to the parsing cannot quietly trade one
    // half of the taxonomy for the other.
    const e = await refusal("PAST_DATE");
    expect(e?.message).toBe("You can't apply for leave in the past.");
  });

  it("keeps the raw code for a support conversation", async () => {
    const e = await refusal("INSUFFICIENT_NOTICE: 5 days required");
    expect(e?.details?.code).toBe("INSUFFICIENT_NOTICE: 5 days required");
  });

  it("shows a Postgres message to nobody", async () => {
    // The other half of the contract. A constraint name is schema disclosure
    // and reads as gibberish; anything unrecognised has to become the generic
    // sentence rather than being passed through.
    const e = await refusal('duplicate key value violates unique constraint "uq_leave_type_name"');
    expect(e?.message).toBe("That didn't work. Please try again.");
  });
});

/**
 * Whole days or halves — Sada, 7 Aug 2026, on being shown 0.3 and 0.7 in a
 * balance: "that confuses the end user."
 *
 * These mirror leave_type_days_are_halves and leave_type_per_request_is_halves
 * exactly. A form that accepts what the database refuses produces an
 * unexplained failure, which is the specific bug this module has met more than
 * once — so the constraint and the schema are asserted together or not at all.
 */
describe("LeaveTypeInput — days come in halves", () => {
  const base = {
    name: "Casual",
    maxDaysPerYear: 12,
    minNoticeDays: null,
    maxPerRequest: null,
    approvalRequired: true,
  };

  it("accepts whole days and halves", () => {
    for (const days of [0, 0.5, 12, 12.5, 365]) {
      expect(LeaveTypeInput.parse({ ...base, maxDaysPerYear: days }).maxDaysPerYear).toBe(days);
    }
  });

  it("refuses the decimals that started this", () => {
    for (const days of [0.3, 0.7, 2.4, 12.1]) {
      expect(() => LeaveTypeInput.parse({ ...base, maxDaysPerYear: days })).toThrow();
    }
  });

  it("applies the same grid to the per-request maximum", () => {
    expect(LeaveTypeInput.parse({ ...base, maxPerRequest: 2.5 }).maxPerRequest).toBe(2.5);
    expect(() => LeaveTypeInput.parse({ ...base, maxPerRequest: 2.7 })).toThrow();
  });

  it("still lets the per-request maximum be null, which means no limit", () => {
    // Null is not zero here, and never was. The grid must not quietly turn
    // "no limit" into a number.
    expect(LeaveTypeInput.parse({ ...base, maxPerRequest: null }).maxPerRequest).toBeNull();
  });

  it("keeps null notice distinct from zero notice", () => {
    // The distinction the workspace default depends on: null inherits it, zero
    // overrides it with "none". The form pre-filled zero until 7 Aug 2026, so
    // the default could never be reached.
    expect(LeaveTypeInput.parse({ ...base, minNoticeDays: null }).minNoticeDays).toBeNull();
    expect(LeaveTypeInput.parse({ ...base, minNoticeDays: 0 }).minNoticeDays).toBe(0);
  });
});

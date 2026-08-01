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

const calls = vi.hoisted(() => ({ eq: [] as [string, unknown][], uid: "ravi" as string | null }));

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
      auth: {
        getUser: () => Promise.resolve({ data: { user: calls.uid ? { id: calls.uid } : null } }),
      },
    },
  };
});

const { getMyRequests } = await import("./handlers");

beforeEach(() => {
  calls.eq = [];
  calls.uid = "ravi";
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

/**
 * D113. A person's own change requests, answered ones included: the list asks
 * for every status by sending null, never by leaving the status out, which the
 * database reads as 'open' only. Sada declined Priya's request and she never
 * saw why, because it had left her list.
 */

import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: [], error: null })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { listChangeRequests } from "./handlers";

describe("listing change requests", () => {
  it("asks for every status, as null, for a person's own list", async () => {
    await listChangeRequests(null);
    expect(rpc).toHaveBeenCalledWith("employee_change_requests", { _status: null });
    const sent = JSON.parse(JSON.stringify((rpc.mock.calls[0] as unknown[])[1]));
    expect(sent).toHaveProperty("_status", null);
  });

  it("passes a status through as it is", async () => {
    rpc.mockClear();
    await listChangeRequests("declined");
    expect(rpc).toHaveBeenCalledWith("employee_change_requests", { _status: "declined" });
  });
});

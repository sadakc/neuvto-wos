// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitDemoRequest } from "./demo-request";

const fetchMock = vi.fn();

const ok = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
const fail = (status: number, error?: string) => ({
  ok: false,
  status,
  json: async () => (error ? { error } : {}),
});

const valid = { name: "Priya", email: "priya@acme.test", company: "", employees: "", message: "" };

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(ok());
  vi.stubGlobal("fetch", fetchMock);
});

const initOf = (call = 0) => fetchMock.mock.calls[call][1] as Record<string, unknown>;
const bodyOf = (call = 0) => JSON.parse(initOf(call).body as string);

describe("where the demo form posts, and what it carries", () => {
  it("posts to the demo-request edge function", async () => {
    await submitDemoRequest(valid);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/functions\/v1\/demo-request$/);
  });

  it("sends only Content-Type, so no credential header forces a preflight", async () => {
    // The bug that shipped on client-error, 6 Aug 2026: supabase-js's
    // functions.invoke attaches apikey/authorization/x-client-info, the
    // endpoint's allow-list named only content-type, and every real browser was
    // refused at the preflight while curl sailed through. Nothing to
    // authenticate to here, so nothing is sent.
    await submitDemoRequest(valid);
    const headers = initOf().headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual(["Content-Type"]);
  });

  it("sends the trimmed fields", async () => {
    await submitDemoRequest({ ...valid, name: "  Priya  ", company: "  Acme  " });
    const b = bodyOf();
    expect(b.name).toBe("Priya");
    expect(b.company).toBe("Acme");
  });
});

describe("what never reaches the network", () => {
  it("a missing name", async () => {
    await expect(submitDemoRequest({ ...valid, name: "" })).rejects.toThrow(/your name/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a malformed address", async () => {
    await expect(submitDemoRequest({ ...valid, email: "priya-at-acme" })).rejects.toThrow(
      /email address/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what the person is told when it fails", () => {
  it("shows the endpoint's message when it is one they can act on", async () => {
    fetchMock.mockResolvedValue(
      fail(429, "Too many requests. Please wait a moment and try again."),
    );
    await expect(submitDemoRequest(valid)).rejects.toThrow(/too many requests/i);
  });

  it("falls back to a generic message when the endpoint gives none", async () => {
    // A 500 body is ours to read, not theirs. Postgres text names columns and
    // constraints and reads as gibberish to somebody who wants a demo.
    fetchMock.mockResolvedValue(fail(500));
    await expect(submitDemoRequest(valid)).rejects.toThrow(/could not submit request/i);
  });

  it("does not leak a raw network error", async () => {
    fetchMock.mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND udrzhfgwqgolvyimbwto.supabase.co"),
    );
    await expect(submitDemoRequest(valid)).rejects.toThrow(/could not reach us/i);
    await expect(submitDemoRequest(valid)).rejects.not.toThrow(/ENOTFOUND/);
  });

  it("resolves quietly on success, so the caller can just await it", async () => {
    await expect(submitDemoRequest(valid)).resolves.toBeUndefined();
  });
});

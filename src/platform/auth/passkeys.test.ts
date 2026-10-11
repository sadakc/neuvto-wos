/**
 * The passkey opt-in, pinned against the installed library (D79).
 *
 * passkeys.ts switches Supabase's experimental passkey API on at runtime
 * rather than in the Lovable-generated client. That only works while
 * auth-js reads the flag on every call. If an upgrade starts reading it once,
 * at construction, this file fails, which is the point: the alternative is
 * finding out from somebody whose face no longer signs them in.
 */

import { describe, expect, it, vi } from "vitest";
import { GoTrueClient } from "@supabase/auth-js";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));

const { enablePasskeysOn, isCancelled, refusalForTest } = await import("./passkeys");

const fresh = () =>
  new GoTrueClient({
    url: "http://127.0.0.1:1/auth/v1",
    persistSession: false,
    autoRefreshToken: false,
  });

describe("the runtime opt-in", () => {
  it("is refused before it is switched on, which is what makes the test meaningful", async () => {
    await expect(fresh().signInWithPasskey()).rejects.toThrow(/experimental/);
  });

  it("is accepted after it is switched on, on a client created without it", async () => {
    const client = fresh();
    enablePasskeysOn(client);
    // No WebAuthn under node, so the library answers with an error rather than
    // throwing the experimental refusal. Getting past the refusal is the test.
    const result = await client.signInWithPasskey();
    expect(String(result.error?.message ?? "")).not.toMatch(/experimental/);
  });

  it("keeps any other experimental flags already set", () => {
    const client = fresh() as unknown as { experimental: Record<string, boolean> };
    client.experimental = { somethingElse: true };
    enablePasskeysOn(client);
    expect(client.experimental).toEqual({ somethingElse: true, passkey: true });
  });
});

describe("a cancelled prompt is not a failure", () => {
  it.each([
    { name: "NotAllowedError" },
    { name: "AbortError" },
    { code: "ERROR_CEREMONY_ABORTED" },
    { message: "The operation either timed out or was not allowed." },
  ])("%o reads as cancelled", (e) => {
    expect(isCancelled(e)).toBe(true);
  });

  it.each([{ code: "webauthn_credential_not_found" }, { code: "passkey_disabled" }, null])(
    "%o does not",
    (e) => {
      expect(isCancelled(e)).toBe(false);
    },
  );
});

describe("refusals say what actually happened", () => {
  it("a session the server no longer holds is a sign-in problem, not a device one", () => {
    const e = refusalForTest({ code: "session_not_found" }, "list");
    expect(e.code).toBe("UNAUTHENTICATED");
    expect(e.message).toMatch(/session has ended/);
    expect(e.message).not.toMatch(/device couldn't be set up/);
  });

  it("a failed list is not described as a failed set-up", () => {
    expect(refusalForTest({ code: "something_new" }, "list").message).toMatch(/couldn't be loaded/);
  });

  it("an unknown device on sign-in says how to set one up", () => {
    expect(refusalForTest({ code: "webauthn_credential_not_found" }, "sign-in").message).toMatch(
      /Sign-in and security/,
    );
  });
});

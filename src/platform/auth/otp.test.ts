/**
 * `requestOtp` — who is allowed to have an account minted for them.
 *
 * The bug this file exists for: the sign-in form passed `shouldCreateUser: true`
 * unconditionally, so typing any address into it created a real row in
 * `auth.users` and mailed a stranger a six-digit code. Proven against a live
 * GoTrue on 24 Aug 2026 — `create_user: true` with an unknown address returned
 * 200 and the row was there afterwards.
 *
 * The rule being pinned: an account is minted ONLY for somebody arriving with
 * an invitation. Everyone else must already exist, and is told plainly when
 * they do not.
 *
 * The 422 / `otp_disabled` pair below is not invented — it is what the local
 * GoTrue actually returns for `create_user: false` against an unknown address:
 *
 *     HTTP 422 {"error_code":"otp_disabled","msg":"Signups not allowed for otp"}
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOtp: h.signInWithOtp } },
}));

import { requestOtp } from "./otp";
import { isAppError } from "@/platform/errors";

/** What GoTrue sends when `create_user` is false and the address is unknown. */
function unknownAddress() {
  h.signInWithOtp.mockResolvedValue({
    error: { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" },
  });
}

function accepted() {
  h.signInWithOtp.mockResolvedValue({ error: null });
}

/** The options object the call was made with. */
function optionsOf(call = 0) {
  return h.signInWithOtp.mock.calls[call]?.[0]?.options ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  accepted();
});

describe("an account is minted only for the invited", () => {
  it("refuses to create one for a plain sign-in", async () => {
    await requestOtp({ email: "stranger@nowhere.test" });
    expect(optionsOf().shouldCreateUser).toBe(false);
  });

  it("creates one when an invitation is being redeemed", async () => {
    // D39's only door. `profiles.id` references `auth.users`, so an invitee has
    // no account until this call makes one — refusing here would weld the door
    // shut and nobody could ever join a workspace.
    await requestOtp({ email: "newjoiner@acme.test" }, { redeemingInvitation: true });
    expect(optionsOf().shouldCreateUser).toBe(true);
  });

  it("treats an absent option as not invited, rather than as invited", async () => {
    // The safe default matters more than the convenient one: a call site that
    // forgets the flag should stop minting accounts, not start.
    await requestOtp({ email: "stranger@nowhere.test" }, {});
    expect(optionsOf().shouldCreateUser).toBe(false);
  });
});

describe("an unregistered address is told so", () => {
  it("raises EMAIL_NOT_REGISTERED, not a generic failure", async () => {
    unknownAddress();
    const err = await requestOtp({ email: "xyz@nowhere.test" }).catch((e) => e);
    expect(isAppError(err)).toBe(true);
    expect(err.code).toBe("EMAIL_NOT_REGISTERED");
  });

  it("carries a message written for the person reading it", async () => {
    unknownAddress();
    const err = await requestOtp({ email: "xyz@nowhere.test" }).catch((e) => e);
    expect(err.message).toContain("has not been registered");
    expect(err.message).toContain("administrator");
  });

  it("does not swallow a rate limit as a missing account", async () => {
    // 429 and 422 are both "no code for you" and read alike from the screen.
    // Telling somebody who has asked five times that they are not registered
    // would send them to an administrator who can find nothing wrong.
    h.signInWithOtp.mockResolvedValue({
      error: { status: 429, code: "over_email_send_rate_limit", message: "rate limited" },
    });
    const err = await requestOtp({ email: "alice.admin@acme.test" }).catch((e) => e);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("lets a registered address through untouched", async () => {
    await expect(requestOtp({ email: "alice.admin@acme.test" })).resolves.toBeUndefined();
  });
});

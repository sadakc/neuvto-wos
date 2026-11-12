// @vitest-environment happy-dom

/**
 * `/auth` — "Sign in with face or fingerprint" (D79).
 *
 * Two promises, both about what happens around the passkey rather than inside
 * it (passkeys.test.ts covers the library):
 *
 *   · The button exists only where it can work: a device that can do passkeys,
 *     and no invitation in the URL — somebody redeeming one has never signed
 *     in, so this device cannot hold a passkey for them.
 *   · Afterwards it is EXACTLY the email code's path, through `afterSignIn`.
 *     A second post-sign-in route is how one of them quietly stops sending
 *     Neuvto staff to the console (D42).
 *
 * Same seams as auth.test.tsx: the router, `@/platform/auth` (the network),
 * `@/platform/navigate` (the page leaving). Plus `@/platform/auth/passkeys`,
 * which is the device, and `sonner`, so "a cancel shows nothing" is something
 * that can be observed rather than assumed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  search: { next: "" } as { next: string; invite?: string },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useSearch: () => h.search,
  }),
}));

vi.mock("@/platform/navigate", () => ({ hardNavigate: vi.fn() }));

vi.mock("@/platform/auth", () => ({
  getCurrentUser: vi.fn(),
  getSessionEmail: vi.fn(),
  isPlatformAdmin: vi.fn(),
  accountStatus: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  acceptInvitation: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock("@/platform/auth/passkeys", () => ({
  deviceSupportsPasskeys: vi.fn(),
  signInWithFaceOrFingerprint: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { AppError } from "@/platform/errors";
import { CONSOLE_PATH } from "@/platform/console-path";
import { hardNavigate } from "@/platform/navigate";
import { accountStatus, getCurrentUser, getSessionEmail, isPlatformAdmin } from "@/platform/auth";
import { deviceSupportsPasskeys, signInWithFaceOrFingerprint } from "@/platform/auth/passkeys";
import { Route } from "./auth";

const AuthPage = (Route as unknown as { component: () => React.ReactElement }).component;

const navigate = vi.mocked(hardNavigate);
const supports = vi.mocked(deviceSupportsPasskeys);
const passkey = vi.mocked(signInWithFaceOrFingerprint);

const NO_ORG = new AppError("NO_ORGANIZATION", "Your account is not linked to a workspace yet.");

const TENANT_USER = {
  id: "ravi-id",
  email: "ravi.emp@acme.test",
  fullName: "Ravi Employee",
  organizationId: "org",
  organizationName: "Acme",
  roles: ["employee"],
};

const BUTTON = { name: /sign in with face or fingerprint/i };

/**
 * The sign-in form is on screen AND the device question has been answered.
 * Asserting a button is absent before `deviceSupportsPasskeys` has resolved
 * would pass against any code at all.
 */
async function signInFormSettled() {
  await screen.findByLabelText(/work email/i);
  await waitFor(() => expect(supports).toHaveBeenCalled());
  await act(async () => {
    await supports.mock.results[0].value;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.search = { next: "" };
  // Signed out on arrival, which is the only way the form renders.
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  vi.mocked(getSessionEmail).mockResolvedValue(null);
  vi.mocked(isPlatformAdmin).mockResolvedValue(false);
  vi.mocked(accountStatus).mockResolvedValue("none");
  supports.mockResolvedValue(true);
  passkey.mockResolvedValue(false);
});

describe("/auth — when the face or fingerprint button is offered", () => {
  it("is offered on a device that can do it", async () => {
    render(<AuthPage />);
    expect(await screen.findByRole("button", BUTTON)).toBeInTheDocument();
  });

  it("is not offered on a device that cannot", async () => {
    // A button that exists only to fail.
    supports.mockResolvedValue(false);
    render(<AuthPage />);
    await signInFormSettled();
    expect(screen.queryByRole("button", BUTTON)).toBeNull();
  });

  it("is not offered to somebody redeeming an invitation, even on a device that can", async () => {
    h.search = { next: "", invite: "tok-abc" };
    render(<AuthPage />);
    await signInFormSettled();
    expect(screen.queryByRole("button", BUTTON)).toBeNull();
    // The form itself is still there — the invitation path is the email code.
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
  });
});

describe("/auth — pressing it", () => {
  it("asks the device, and a cancelled prompt shows nothing and goes nowhere", async () => {
    // Cancelling the system prompt is somebody choosing the email code instead.
    // Not an error, not a toast, and certainly not the post-sign-in routing,
    // which for a signed-out browser ends on "you're not in a workspace yet".
    passkey.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<AuthPage />);

    await user.click(await screen.findByRole("button", BUTTON));

    await waitFor(() => expect(passkey).toHaveBeenCalledTimes(1));
    // Let anything the press set going finish — every seam here is a resolved
    // mock, so the whole post-sign-in chain is a handful of microtasks. Waiting
    // on the button instead would fail, under the regression, by reporting a
    // missing button rather than the screen that replaced it.
    await act(() => new Promise((r) => setTimeout(r, 50)));

    expect(screen.queryByRole("heading", { name: /not in a workspace yet/i })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Sign in to Neuvto" })).toBeInTheDocument();
    expect(screen.getByRole("button", BUTTON)).toBeEnabled();
  });

  it("lands a tenant user on the page `next` asked for, like the email code does", async () => {
    h.search = { next: "/app/leave?type=annual" };
    vi.mocked(getCurrentUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(TENANT_USER as never);
    passkey.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<AuthPage />);

    await user.click(await screen.findByRole("button", BUTTON));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls).toEqual([["/app/leave?type=annual"]]);
  });

  it("does not follow a `next` that leaves the site", async () => {
    // The same parser as the email code. A passkey path with its own copy of
    // the redirect rule would be the open redirect found on 4 Aug, again.
    h.search = { next: "/\\evil.example.com/x" };
    vi.mocked(getCurrentUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(TENANT_USER as never);
    passkey.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<AuthPage />);

    await user.click(await screen.findByRole("button", BUTTON));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls).toEqual([["/app"]]);
  });

  it("lands a workspaceless member of Neuvto staff on the console (D42)", async () => {
    // The branch the shared afterSignIn exists to protect. Staff have no
    // workspace by design; without this they would be told to ask their
    // administrator for an invitation.
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null).mockRejectedValue(NO_ORG);
    vi.mocked(isPlatformAdmin).mockResolvedValue(true);
    passkey.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<AuthPage />);

    await user.click(await screen.findByRole("button", BUTTON));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls).toEqual([[CONSOLE_PATH]]);
    expect(screen.queryByRole("heading", { name: /not in a workspace yet/i })).toBeNull();
  });
});

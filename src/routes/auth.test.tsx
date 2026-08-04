// @vitest-environment happy-dom

/**
 * `/auth` — who gets answered, and who gets obeyed.
 *
 * The bug this file exists for: clicking "Sign in" on the landing page sent a
 * signed-in platform admin straight to `/neuvto-hq`. The sign-in form never
 * rendered, `?next=` was ignored entirely, and `/app` was unreachable — it
 * bounces to `/auth`, which bounced back to the console. Sada hit it on the
 * first attempt.
 *
 * It had no test for a mechanical reason: the redirect was
 * `window.location.href = …`, and happy-dom throws on navigation, so the only
 * observable outcome was a crash. `src/platform/navigate.ts` exists to be
 * mocked here; every assertion below reads the destination out of it.
 *
 * THE RULE being pinned, in the words of the module itself: a `/auth` URL
 * carrying no `next` and no `invite` is a deliberate request for the sign-in
 * screen, and is answered rather than obeyed. Arriving WITH `next` or `invite`
 * means something sent you here with intent, and that is followed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── the seam
//
// auth.tsx calls createFileRoute at module load and reads its search params
// through the object that call returns, so the router is replaced and
// `useSearch` is wired to a per-test object. `@/platform/auth` is the network,
// and `@/platform/navigate` is the page leaving. Nothing below those is mocked:
// the component's own decisions — which screen, which words, which destination
// — are the thing under test and are all real.

const h = vi.hoisted(() => ({
  search: { next: "" } as { next: string; invite?: string; reason?: "idle" | "absolute" },
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

import { AppError } from "@/platform/errors";
import { CONSOLE_PATH } from "@/platform/console-path";
import { hardNavigate } from "@/platform/navigate";
import {
  accountStatus,
  getCurrentUser,
  getSessionEmail,
  isPlatformAdmin,
  requestOtp,
  signOut,
  verifyOtp,
} from "@/platform/auth";
import { Route } from "./auth";

const AuthPage = (Route as unknown as { component: () => React.ReactElement }).component;

const navigate = vi.mocked(hardNavigate);

/** Authenticated, but in no workspace — what every Neuvto staff member is (D42). */
const NO_ORG = new AppError("NO_ORGANIZATION", "Your account is not linked to a workspace yet.");

const STAFF_EMAIL = "sada@neuvto.com";

const TENANT_USER = {
  id: "ravi-id",
  email: "ravi.emp@acme.test",
  fullName: "Ravi Employee",
  organizationId: "org",
  organizationName: "Acme",
  roles: ["employee"],
};

/** Signed in with a workspace: an ordinary employee of a customer. */
function tenantSession() {
  vi.mocked(getCurrentUser).mockResolvedValue(TENANT_USER as never);
}

/** Signed in, no workspace, and Neuvto staff. */
function staffSession() {
  vi.mocked(getCurrentUser).mockRejectedValue(NO_ORG);
  vi.mocked(getSessionEmail).mockResolvedValue(STAFF_EMAIL);
  vi.mocked(isPlatformAdmin).mockResolvedValue(true);
}

/** Signed in, no workspace, and nobody's staff — an invitee who never got one. */
function orphanSession(status: "active" | "deactivated" = "active") {
  vi.mocked(getCurrentUser).mockRejectedValue(NO_ORG);
  vi.mocked(getSessionEmail).mockResolvedValue("stranger@nowhere.test");
  vi.mocked(isPlatformAdmin).mockResolvedValue(false);
  vi.mocked(accountStatus).mockResolvedValue(status);
}

/** Class tokens, so `flex-col` cannot be satisfied by `flex-col-reverse`. */
function classesOf(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Every paragraph the page owns, in order, as a reader would meet them. */
function copyOnScreen(): string[] {
  return [...document.querySelectorAll("main > p")].map((p) => p.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.search = { next: "" };
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  vi.mocked(getSessionEmail).mockResolvedValue(null);
  vi.mocked(isPlatformAdmin).mockResolvedValue(false);
  vi.mocked(accountStatus).mockResolvedValue("none");
});

describe("?next= cannot leave the site", () => {
  // The old guard was three string checks carrying a comment claiming they made
  // an open redirect impossible. `/\\evil.example.com/x` starts with "/", does
  // not start with "//", and browsers fold the backslash into a slash inside a
  // special scheme — so it resolved to https://evil.example.com/x. On the
  // sign-in page, which is where somebody is about to be asked for the
  // six-digit code we just emailed them.
  const ESCAPES = ["/\\evil.example.com/x", "/\\/evil.example.com", "//evil.example.com"];

  it.each(ESCAPES)("refuses to send a tenant user to %s", async (hostile) => {
    h.search = { next: hostile };
    tenantSession();
    render(<AuthPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const dest = navigate.mock.calls[0][0];
    expect(new URL(dest, "https://neuvto.com").origin).toBe("https://neuvto.com");
    expect(dest).not.toContain("evil.example.com");
  });

  it.each(ESCAPES)("refuses to send a platform admin to %s", async (hostile) => {
    h.search = { next: hostile };
    staffSession();
    render(<AuthPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const dest = navigate.mock.calls[0][0];
    expect(new URL(dest, "https://neuvto.com").origin).toBe("https://neuvto.com");
    expect(dest).not.toContain("evil.example.com");
  });

  it("still follows an ordinary same-origin deep link", async () => {
    h.search = { next: "/app/leave?type=annual" };
    tenantSession();
    render(<AuthPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/leave?type=annual"));
  });
});

describe("/auth — a Sign in click by somebody already signed in", () => {
  it("answers a platform admin instead of bouncing them to the console", async () => {
    // THE REGRESSION. `next` empty and no invite is the landing page's "Sign in"
    // link exactly as it ships. Before the fix this navigated to /neuvto-hq
    // before anything rendered, which is how /app became unreachable for Neuvto
    // staff: /app bounces here, and here bounced back.
    staffSession();
    h.search = { next: "" };

    render(<AuthPage />);

    await waitFor(() => {
      // Asserted first so that a regression fails by naming the navigation that
      // should not have happened, rather than by reporting a missing heading.
      expect(navigate.mock.calls).toEqual([]);
      expect(screen.getByRole("heading", { name: /already signed in/i })).toBeInTheDocument();
    });

    // And it says who this browser is, read from the session rather than a
    // profile — staff have no profile, which is the whole reason getCurrentUser
    // threw in the first place.
    expect(screen.getByText(STAFF_EMAIL)).toBeInTheDocument();
    // The door is offered, not walked through.
    expect(screen.getByTestId("signed-in-continue")).toHaveAttribute("href", CONSOLE_PATH);
    expect(screen.getByTestId("signed-in-continue")).toHaveTextContent("Continue to the console");
  });

  it("answers a tenant user with their workspace one click away, not a bounce", async () => {
    // On a shared laptop this is what stops a colleague's workspace appearing to
    // whoever clicks Sign in. Before the fix it navigated straight into /app in
    // the previous person's session.
    tenantSession();
    h.search = { next: "" };

    render(<AuthPage />);

    await waitFor(() => {
      expect(navigate.mock.calls).toEqual([]);
      expect(screen.getByRole("heading", { name: /already signed in/i })).toBeInTheDocument();
    });

    expect(screen.getByText(TENANT_USER.email)).toBeInTheDocument();
    const cont = screen.getByTestId("signed-in-continue");
    expect(cont).toHaveTextContent("Continue to your workspace");
    expect(cont).toHaveAttribute("href", "/app");
    // The session variant leads with continuing; the invite variant leads with
    // signing out. This is the CSS half of that — DOM order is identical in both.
    const buttons = screen.getByTestId("signed-in-sign-out").parentElement as HTMLElement;
    expect(classesOf(buttons)).toContain("flex-col-reverse");
    expect(classesOf(cont)).toContain("bg-primary");
  });
});

describe("/auth — arriving with intent", () => {
  it("follows a deep link out of the console for a platform admin", async () => {
    // `next` used to be ignored outright, so the console's own bounce landed
    // people back at CONSOLE_PATH whatever page they had asked for. A path
    // deeper than CONSOLE_PATH is used deliberately: `?next=/neuvto-hq` alone
    // cannot tell the fix from the bug, since the old code navigated there too.
    staffSession();
    h.search = { next: "/neuvto-hq/customers" };

    render(<AuthPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/neuvto-hq/customers"));
    expect(screen.queryByRole("heading", { name: /already signed in/i })).toBeNull();
  });

  it("follows the console's own bounce", async () => {
    // The literal reported case. Kept for the record even though it cannot
    // discriminate the fix from the bug on its own — see the test above.
    staffSession();
    h.search = { next: CONSOLE_PATH };

    render(<AuthPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(CONSOLE_PATH));
    expect(screen.queryByRole("heading", { name: /already signed in/i })).toBeNull();
  });

  it("refuses to send a staff member into /app, however they were sent there", async () => {
    // A staff member has no profile, so /app throws NO_ORGANIZATION and bounces
    // them back here — with ?next=/app/leave, forever. `next` is honoured
    // everywhere except into the one place that cannot hold them.
    staffSession();
    h.search = { next: "/app/leave" };

    render(<AuthPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(CONSOLE_PATH));
    expect(navigate).not.toHaveBeenCalledWith("/app/leave");
    expect(navigate.mock.calls).toEqual([[CONSOLE_PATH]]);
  });

  it("follows a deep link for a tenant user", async () => {
    tenantSession();
    h.search = { next: "/app/leave" };

    render(<AuthPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/leave"));
    expect(screen.queryByRole("heading", { name: /already signed in/i })).toBeNull();
  });
});

describe("/auth — verifying a code is intent", () => {
  it("still lands a workspaceless platform admin on the console after verifying", async () => {
    // THE D42 GUARD. Somebody who has just typed a six-digit code has expressed
    // intent as clearly as anybody ever does, so there is no interstitial here —
    // and Neuvto staff, who by design never have a workspace, must still arrive
    // somewhere. Losing this re-creates the original dead end for every member
    // of staff, from the other direction.
    //
    // Signed OUT on arrival, which is why the form renders at all; the session
    // that exists after verifying has no workspace.
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null).mockRejectedValue(NO_ORG);
    vi.mocked(isPlatformAdmin).mockResolvedValue(true);
    vi.mocked(requestOtp).mockResolvedValue(undefined as never);
    vi.mocked(verifyOtp).mockResolvedValue(undefined as never);
    h.search = { next: "" };

    const user = userEvent.setup();
    render(<AuthPage />);

    await user.type(await screen.findByLabelText(/work email/i), STAFF_EMAIL);
    await user.click(screen.getByRole("button", { name: "Email me a code" }));

    await user.type(await screen.findByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(CONSOLE_PATH));
    expect(verifyOtp).toHaveBeenCalledWith({ email: STAFF_EMAIL, token: "123456" });
    // Not the "ask your administrator to invite you" dead end, which is what a
    // staff member used to be shown here.
    expect(screen.queryByRole("heading", { name: /not in a workspace yet/i })).toBeNull();
  });
});

describe("/auth — an invitation opened in somebody else's session", () => {
  it("keeps the invitation wording exactly as it was", async () => {
    // Pinned byte-for-byte on purpose. The comment above this screen in auth.tsx
    // records why the invited address is absent — printing it would rebuild in
    // the browser the token oracle that invitation_accept exists to deny (D39).
    // A reword that slips the address in, or softens the conditional sentence
    // into an assertion about whose invitation this is, is a security change
    // wearing a copy edit's clothes.
    tenantSession();
    h.search = { next: "", invite: "tok-abc" };

    render(<AuthPage />);

    await screen.findByRole("heading", { name: /already signed in/i });

    expect(copyOnScreen()).toEqual([
      `This browser is signed in as ${TENANT_USER.email}. An invitation is accepted by the address it was sent to.`,
      "If this invitation is for a different address, sign out and we'll email a 6-digit code to it.",
    ]);
    // The invited address is NOT on screen. It is not even known to this
    // component; this asserts it stays that way.
    expect(document.body.textContent).not.toContain("tok-abc");

    // Signing out leads, because holding an invitation the likely intent is
    // "this is not my address".
    const signOutBtn = screen.getByTestId("signed-in-sign-out");
    expect(signOutBtn).toHaveTextContent("Sign out and use a different address");
    expect(classesOf(signOutBtn)).toContain("bg-primary");
    const cont = screen.getByTestId("signed-in-continue");
    expect(cont).toHaveTextContent("Stay signed in and continue");
    expect(classesOf(cont)).not.toContain("bg-primary");
    expect(classesOf(signOutBtn.parentElement as HTMLElement)).toContain("flex-col");
  });
});

describe("/auth — the screens that used to be dead ends", () => {
  it("lets somebody with no workspace sign out and use another address", async () => {
    // The advice on this screen is "ask your administrator to invite you",
    // which is useless if the address being invited is not the one this browser
    // is signed in as — and until now there was no way to change that.
    orphanSession("active");
    h.search = { next: "" };

    const user = userEvent.setup();
    render(<AuthPage />);

    await screen.findByRole("heading", { name: /not in a workspace yet/i });
    await user.click(screen.getByTestId("orphan-sign-out"));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/auth");
  });

  it("lets a deactivated person sign out and use another address", async () => {
    // Deactivated and never-invited are indistinguishable from getCurrentUser —
    // both raise NO_ORGANIZATION — so only accountStatus separates them, and
    // they must stay separated: telling somebody who worked here for six years
    // that they were never here is both wrong and useless advice.
    orphanSession("deactivated");
    h.search = { next: "" };

    const user = userEvent.setup();
    render(<AuthPage />);

    await screen.findByRole("heading", { name: /access has been removed/i });
    expect(screen.queryByRole("heading", { name: /not in a workspace yet/i })).toBeNull();

    await user.click(screen.getByTestId("deactivated-sign-out"));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/auth");
  });

  it("carries the destination through a sign-out, but not the reason", async () => {
    // `reason` describes why the LAST session ended. Re-showing "you were signed
    // out after a period of inactivity" to somebody who has just chosen to sign
    // out is noise about an event they already know about. `next` is the
    // opposite: they asked for that page and are still asking.
    orphanSession("active");
    h.search = { next: "/app/leave", reason: "idle" };

    const user = userEvent.setup();
    render(<AuthPage />);

    await screen.findByRole("heading", { name: /not in a workspace yet/i });
    await user.click(screen.getByTestId("orphan-sign-out"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/auth?next=%2Fapp%2Fleave"));
  });
});

describe("/auth — why the last session ended", () => {
  it("says so when it was inactivity", async () => {
    h.search = { next: "", reason: "idle" };
    render(<AuthPage />);

    const note = await screen.findByTestId("signed-out-idle");
    expect(note).toHaveTextContent(
      "You were signed out after a period of inactivity. Sign in again to carry on.",
    );
    expect(screen.queryByTestId("signed-out-absolute")).toBeNull();
  });

  it("says something different when the session simply ran out", async () => {
    // Two different nothings: "you stepped away" and "your session reached its
    // limit" are answers to different questions, and only one of them is about
    // anything the person did.
    h.search = { next: "", reason: "absolute" };
    render(<AuthPage />);

    const note = await screen.findByTestId("signed-out-absolute");
    expect(note).toHaveTextContent(
      "You were signed out because your session reached its time limit. Sign in again to carry on.",
    );
    expect(screen.queryByTestId("signed-out-idle")).toBeNull();
  });

  it("says nothing at all when there was no last session", async () => {
    h.search = { next: "" };
    render(<AuthPage />);

    await screen.findByRole("heading", { name: "Sign in to Neuvto" });
    expect(screen.queryByTestId("signed-out-idle")).toBeNull();
    expect(screen.queryByTestId("signed-out-absolute")).toBeNull();
    expect(document.body.textContent).not.toContain("You were signed out");
  });
});

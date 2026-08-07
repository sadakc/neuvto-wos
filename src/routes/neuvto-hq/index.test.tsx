// @vitest-environment happy-dom

/**
 * The way out of Neuvto's own console.
 *
 * Until this change there wasn't one. The console sits deliberately outside
 * `/app`, so it inherits none of the tenant shell's header, and a platform
 * admin's only way to end a session was to clear cookies — on the one page that
 * lists every customer Neuvto has.
 *
 * ── what is real here and what is not
 *
 * `@/platform/auth` is the network and is replaced whole. Everything above it is
 * the original: `MailHealthBanner`, `ClientErrorsPanel`, `NeuvtoLockup`,
 * `CONSOLE_PATH` and every decision the console makes for itself. Only the
 * router is stubbed, because `createFileRoute` runs at module load.
 *
 * ── the destination
 *
 * The console assigns `window.location.href` directly rather than going through
 * `hardNavigate` in `@/platform/navigate` — the seam this project added because
 * a raw assignment cannot be observed by a test. So there is no module to mock
 * here and the assignment is intercepted instead: `href` is an accessor on
 * `Location.prototype` (verified, not assumed), so an own property on the
 * instance shadows it and `delete` puts the real one back between tests.
 *
 * Intercepting rather than reading `window.location.href` afterwards is
 * deliberate twice over. It records what the component actually wrote — `/auth`,
 * not `http://localhost:3000/auth` — and it stops one test's navigation leaking
 * into the next file-shared `window`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppError } from "@/platform/errors";
import type { CustomerWorkspace, MailHealth } from "@/platform/auth";

// ── the seam

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

// Named, so "expected getSessionEmail to not be called at all" is what a
// failure reads as rather than "expected vi.fn()". Which call was made is the
// entire content of two of the assertions below.
vi.mock("@/platform/auth", () => ({
  getUserId: vi.fn().mockName("getUserId"),
  getSessionEmail: vi.fn().mockName("getSessionEmail"),
  signOut: vi.fn().mockName("signOut"),
  isPlatformAdmin: vi.fn().mockName("isPlatformAdmin"),
  listOrganizations: vi.fn().mockName("listOrganizations"),
  listOrganizationModules: vi.fn().mockName("listOrganizationModules"),
  setOrganizationModule: vi.fn().mockName("setOrganizationModule"),
  provisionOrganization: vi.fn().mockName("provisionOrganization"),
  suggestSlug: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")).mockName("suggestSlug"),
  getMailHealth: vi.fn().mockName("getMailHealth"),
  getClientErrors: vi.fn().mockName("getClientErrors"),
}));

import {
  getUserId,
  getSessionEmail,
  signOut,
  isPlatformAdmin,
  listOrganizations,
  getMailHealth,
  getClientErrors,
} from "@/platform/auth";
import { CONSOLE_PATH } from "@/platform/console-path";
import { Route } from "./index";

const AdminConsole = (Route as unknown as { component: () => React.ReactElement }).component;

/**
 * The address that makes this feature necessary rather than tidy.
 *
 * anshvilla@gmail.com is a platform admin AND holds org_admin in a customer
 * workspace, so "which account is this browser in" is a live question on this
 * screen — and the same string is therefore printed twice on it, once as the
 * session and once as a customer's administrator. Every assertion below reads
 * the session element by its test id for that reason; `getByText(EMAIL)` would
 * find two nodes, and a version of this test that searched the page body would
 * pass with the header line deleted.
 */
const EMAIL = "anshvilla@gmail.com";

const ORGS: CustomerWorkspace[] = [
  {
    id: "e2b0c5a4-9d3f-4b21-8a77-1c4f6d2e9b03",
    name: "Acme Security Services",
    slug: "acme",
    createdAt: "2026-05-11T09:12:00Z",
    memberCount: 34,
    adminEmail: EMAIL,
    adminAccepted: true,
    adminInviteUrl: null,
  },
  {
    id: "7a1d4e88-2c60-4f9a-b3d5-0e8c7f1a6524",
    name: "Vistara Facilities",
    slug: "vistara",
    createdAt: "2026-07-02T04:30:00Z",
    memberCount: 8,
    adminEmail: "ops@vistara.test",
    adminAccepted: false,
    adminInviteUrl: "https://neuvto.com/auth?invite=tok-abc",
  },
];

const HEALTHY: MailHealth = {
  healthy: true,
  failed24h: 0,
  pendingNow: 0,
  oldestPendingMinutes: 0,
  lastSentAt: "2026-08-07T10:00:00Z",
  lastFailureAt: null,
  lastFailureReason: null,
};

/** Every URL the page assigned to `window.location.href`, in order. */
const wentTo: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  wentTo.length = 0;

  Object.defineProperty(window.location, "href", {
    configurable: true,
    get: () => `http://localhost:3000${CONSOLE_PATH}`,
    set: (url: string) => {
      wentTo.push(url);
    },
  });

  vi.mocked(getUserId).mockResolvedValue("f0b3a7c2-5e14-4d88-9a6b-2f7c0d1e8534");
  vi.mocked(isPlatformAdmin).mockResolvedValue(true);
  vi.mocked(getSessionEmail).mockResolvedValue(EMAIL);
  vi.mocked(signOut).mockResolvedValue(undefined);
  vi.mocked(listOrganizations).mockResolvedValue(ORGS);
  vi.mocked(getMailHealth).mockResolvedValue(HEALTHY);
  vi.mocked(getClientErrors).mockResolvedValue([]);
});

afterEach(() => {
  delete (window.location as unknown as Record<string, unknown>).href;
});

/**
 * Renders and waits for the console proper.
 *
 * Waits on the sign-out button, which exists in exactly one of the three states
 * this route can be in. Deliberately NOT the `<main>`, which all three render —
 * checking, not-found and the console itself — so a helper that waited on it
 * would resolve on the first paint and hand back a DOM that has decided nothing,
 * making every assertion after it a race rather than a fact.
 */
async function renderConsole() {
  const user = userEvent.setup();
  render(<AdminConsole />);
  await screen.findByTestId("console-sign-out");
  return user;
}

describe("Neuvto console — who is offered a way out", () => {
  it("gives a platform admin one, beside the mark", async () => {
    await renderConsole();

    const out = screen.getByTestId("console-sign-out");
    expect(out).toHaveTextContent("Sign out");
    expect(out).toBeEnabled();
    // In the header, not somewhere down the customer list.
    expect(out.closest("main")?.querySelector("h1")).toHaveTextContent("Customers");
  });

  it("offers a non-admin the not-found and nothing else", async () => {
    // A sign-out button is itself a disclosure: it says there is a session with
    // something here to sign out OF. This page must read identically to a wrong
    // URL for anybody who is not staff.
    vi.mocked(isPlatformAdmin).mockResolvedValue(false);

    render(<AdminConsole />);

    expect(await screen.findByRole("heading", { name: "Not found" })).toBeInTheDocument();
    expect(screen.queryByTestId("console-sign-out")).toBeNull();
    expect(screen.queryByTestId("console-session-email")).toBeNull();
    expect(document.body.textContent).not.toContain("Sign out");
    // …and no customer got named on the way past.
    expect(document.body.textContent).not.toContain("Acme Security Services");
    expect(listOrganizations).not.toHaveBeenCalled();
  });

  it("does not ask the session for an email before the gate has answered", async () => {
    // Ordered after `isPlatformAdmin()` deliberately. `getSessionEmail` is a
    // network call made on behalf of somebody this route has decided to tell
    // nothing to, and its answer is the one string this screen would print about
    // the person reading it.
    vi.mocked(isPlatformAdmin).mockResolvedValue(false);

    render(<AdminConsole />);
    await screen.findByRole("heading", { name: "Not found" });

    expect(getSessionEmail).not.toHaveBeenCalled();
  });

  it("sends somebody signed out to sign in, rather than telling them there is nothing here", async () => {
    // Signed out is NOT the same as not staff. Conflating them stranded the one
    // person who is definitely allowed in, so this case gets a door and the case
    // above gets a not-found — and neither renders any console chrome.
    vi.mocked(getUserId).mockResolvedValue(null);

    render(<AdminConsole />);

    await waitFor(() => expect(wentTo).toEqual(["/auth?next=%2Fneuvto-hq"]));
    expect(new URLSearchParams(wentTo[0].split("?")[1]).get("next")).toBe(CONSOLE_PATH);

    expect(screen.queryByTestId("console-sign-out")).toBeNull();
    expect(screen.queryByTestId("console-session-email")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Not found" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Customers" })).toBeNull();
    // Nothing was asked about them, either.
    expect(isPlatformAdmin).not.toHaveBeenCalled();
    expect(getSessionEmail).not.toHaveBeenCalled();
    expect(listOrganizations).not.toHaveBeenCalled();
  });
});

describe("Neuvto console — signing out", () => {
  it("ends the session once, and leaves the page", async () => {
    const user = await renderConsole();

    await user.click(screen.getByTestId("console-sign-out"));

    await waitFor(() => expect(wentTo).toEqual(["/auth"]));
    expect(signOut).toHaveBeenCalledTimes(1);
    // Not `/auth?next=/neuvto-hq`. Somebody who has just signed out is not asking
    // to be sent back into the console.
    expect(wentTo[0]).not.toContain("next=");
  });

  it("leaves the page even when signing out fails", async () => {
    // THE POINT OF THE CHANGE, and the reason the navigation is in a `finally`.
    // A refused sign-out that strands somebody on a page listing every customer
    // Neuvto has is the worse of the two outcomes; `/auth` re-checks the session
    // on arrival, so a session that survived is caught there rather than here.
    //
    // ── this test is why the file exits non-zero, and that is a real defect
    //
    // The handler is `try { await signOut() } finally { … }` with no `catch`, so
    // the promise React discards rejects and nothing handles it. Vitest reports
    // it as an Unhandled Rejection; a browser reports it as "Uncaught (in
    // promise)" AND hands it to the global `unhandledrejection` listener that
    // `__root.tsx` installs — which files a row in the client-error table, so a
    // deliberately-swallowed sign-out failure appears as a fault in the monitor
    // on this very page.
    //
    // NOT suppressed here, and not asserted either. Suppressing it hides the
    // defect; asserting it pins the defect and would fail this test the day
    // somebody fixes it. Adding `catch {}` to the handler makes the run green
    // with all ten assertions unchanged — verified.
    vi.mocked(signOut).mockRejectedValue(
      new AppError("INTERNAL_ERROR", "The sign-out request failed.", 500),
    );

    const user = await renderConsole();

    await user.click(screen.getByTestId("console-sign-out"));

    await waitFor(() => expect(wentTo).toEqual(["/auth"]));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("says what it is doing and refuses a second click while it is doing it", async () => {
    // Two clicks is two `signOut` calls and two navigations. The label matters
    // as much: an unchanged "Sign out" under a click that did something reads as
    // a button that did nothing, which is how people click it again.
    let release!: () => void;
    vi.mocked(signOut).mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const user = await renderConsole();
    await user.click(screen.getByTestId("console-sign-out"));

    const out = screen.getByTestId("console-sign-out");
    expect(out).toHaveTextContent("Signing out…");
    expect(out).toBeDisabled();
    expect(wentTo).toEqual([]);

    await user.click(out);
    expect(signOut).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(wentTo).toEqual(["/auth"]));
  });
});

describe("Neuvto console — which account this is", () => {
  it("names the session's address, not a profile's", async () => {
    // Read straight from the session, because Neuvto staff have no profile by
    // design (D42) and `getCurrentUser()` raises NO_ORGANIZATION for exactly the
    // people this screen is for.
    await renderConsole();

    const line = screen.getByTestId("console-session-email");
    expect(line).toHaveTextContent(`Signed in as ${EMAIL}`);
    // The same address is on the page as a customer's administrator, so WHERE
    // this one is carries the meaning: it answers "which account am I about to
    // end", and it only answers that beside the button that ends it.
    //
    // Asserted as the same container rather than a shared ancestor. The looser
    // version does not bite — `toContainElement` on the parent still passes with
    // the line moved down to sit above the customer list, because <main>
    // contains both. Watched passing under exactly that sabotage.
    expect(line.parentElement).toBe(screen.getByTestId("console-sign-out").parentElement);
    // The full address is recoverable even though the line truncates.
    expect(line).toHaveAttribute("title", EMAIL);
  });

  it("renders nothing at all when the session has no address to give", async () => {
    // Not an empty box and not "Signed in as null". A line that names nobody is
    // worse than no line: on a screen whose whole job is to say which of two
    // accounts you are in, it answers the question wrongly.
    vi.mocked(getSessionEmail).mockResolvedValue(null);

    await renderConsole();

    expect(screen.queryByTestId("console-session-email")).toBeNull();
    expect(document.body.textContent).not.toContain("Signed in as");
    // The way out is still there — the address is a caption, not the feature.
    expect(screen.getByTestId("console-sign-out")).toBeInTheDocument();
  });

  it("renders nothing when the session lookup fails, and loads the rest anyway", async () => {
    // A failed lookup must not take the console with it. This is the screen
    // somebody opens because something already seems wrong.
    vi.mocked(getSessionEmail).mockRejectedValue(
      new AppError("INTERNAL_ERROR", "session unreadable", 500),
    );

    await renderConsole();

    expect(screen.queryByTestId("console-session-email")).toBeNull();
    expect(document.body.textContent).not.toContain("Signed in as");
    expect(await screen.findByText("Acme Security Services")).toBeInTheDocument();
  });
});

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
 * Two navigations leave this page and they do not leave it the same way. Sign-out
 * goes through `hardNavigate` in `@/platform/navigate`, the seam this project
 * added because a raw assignment cannot be observed by a test; the signed-out
 * redirect to `/auth?next=…` is still a bare `window.location.href = …` in the
 * mount effect, and was deliberately left alone by the change that added the
 * seam.
 *
 * So `@/platform/navigate` is NOT mocked here. The assignment is intercepted one
 * level lower instead, which catches both — `hardNavigate` assigns the same
 * property. `href` is an accessor on `Location.prototype` (verified, not
 * assumed), so an own property on the instance shadows it and `delete` puts the
 * real one back between tests.
 *
 * Intercepting rather than reading `window.location.href` afterwards is
 * deliberate twice over. It records what the component actually wrote — `/auth`,
 * not `http://localhost:3000/auth` — and it stops one test's navigation leaking
 * into the next file-shared `window`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  markTestOrganization: vi.fn().mockName("markTestOrganization"),
  unmarkTestOrganization: vi.fn().mockName("unmarkTestOrganization"),
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
  provisionOrganization,
  markTestOrganization,
  unmarkTestOrganization,
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
    // A real customer. The badge must NOT appear on this row — the assertion
    // that matters is the negative one, because a customer wrongly shown as a
    // test workspace is the marking pointed at the wrong target.
    isTest: false,
    testReason: null,
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
    isTest: true,
    testReason: "Created as an internal test workspace from the console",
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
  vi.mocked(provisionOrganization).mockResolvedValue({
    organizationId: "3f6b9c02-8e57-4a1d-9b44-6d0e2a7c5f18",
  });
  vi.mocked(markTestOrganization).mockResolvedValue(undefined);
  vi.mocked(unmarkTestOrganization).mockResolvedValue(undefined);
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
    // ── why the handler has a `catch` that does nothing
    //
    // This test used to make the whole file exit non-zero, and finding out why is
    // what put the empty `catch` in the handler. `try { await signOut() } finally
    // { … }` with no `catch` leaves the promise React has already discarded
    // rejecting with nobody to handle it. Vitest reports an Unhandled Rejection;
    // a browser reports "Uncaught (in promise)" AND hands it to the global
    // `unhandledrejection` listener `__root.tsx` installs — which files a row in
    // the client-error table, and that table renders in `ClientErrorsPanel` on
    // THIS page. So a sign-out failure the code chose to ignore filed itself as a
    // crash in the one monitor Neuvto staff read, and `report.ts` groups by
    // fingerprint, so retrying during an outage climbed the panel.
    //
    // The catch is therefore load-bearing despite being empty, and the comment on
    // it in index.tsx says so. Delete it and this file exits 1 again.
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

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Marking a workspace as one of Neuvto's own — docs/operations/TEST_DATA_PURGE.md
 *
 * Sada tests in production on purpose, and will one day ask for those rows to be
 * hard-deleted. Nothing in the schema could say which workspace was a rehearsal,
 * so a registry now records it and this checkbox is where the record is made.
 *
 * ── the asymmetry that decides which assertions are worth writing
 *
 * The two ways of getting it wrong are not equally bad, and nothing on screen
 * distinguishes them:
 *
 *   a test workspace left unmarked   → somebody marks it later. An inconvenience.
 *   a real customer marked as test   → that customer is on the allow-list a
 *                                      future purge deletes from.
 *
 * So the negative cases carry the weight here. The tests that matter are the
 * ones proving the mark is ABSENT when nobody asked for it: unchecked on
 * arrival, `false` on the wire rather than missing, unchecked again after a
 * workspace is created, and no badge on a real customer's row.
 *
 * Nothing in the product branches on this value, by design, which is precisely
 * why a wrong one is invisible until the day something deletes by it.
 */

/** What a real customer's provisioning looks like. Not a test workspace. */
const CUSTOMER = { name: "Kanha Logistics", slug: "kanha-logistics", email: "owner@kanha.com" };

/** One of Neuvto's own rehearsals — the case the checkbox exists for. */
const REHEARSAL = { name: "Neuvto Rehearsal", slug: "neuvto-rehearsal", email: "sada@neuvto.com" };

const testBox = () => screen.getByTestId("is-test") as HTMLInputElement;

/**
 * Fills the form the way a person does: company name, then administrator email.
 *
 * The third required field, the workspace address, is left alone deliberately —
 * it follows the company name through `suggestSlug`, and typing it by hand would
 * set `slugEdited` and exercise a path nobody takes on a new customer.
 */
async function fillProvisionForm(
  user: ReturnType<typeof userEvent.setup>,
  who: { name: string; email: string },
) {
  await user.type(screen.getByLabelText("Company name"), who.name);
  await user.type(screen.getByLabelText("Administrator email"), who.email);
}

/**
 * The argument of one `provisionOrganization` call, as an object.
 *
 * Raises with the call count rather than throwing on `undefined[0]`, so a test
 * that submitted nothing fails saying so instead of failing inside this helper.
 */
function provisionArg(index = 0): Record<string, unknown> {
  const calls = vi.mocked(provisionOrganization).mock.calls;
  if (calls.length <= index) {
    throw new Error(
      `wanted the arguments of provisionOrganization call ${index + 1}, but it was called ${calls.length} time(s)`,
    );
  }
  return calls[index][0] as Record<string, unknown>;
}

describe("Neuvto console — marking a new workspace as Neuvto's own", () => {
  it("starts unchecked, so a workspace is a customer's until somebody says otherwise", async () => {
    await renderConsole();

    const box = testBox();
    expect(box.type).toBe("checkbox");
    expect(box).not.toBeChecked();
  });

  it("sends isTest false when nobody touched the box — not undefined, not omitted", async () => {
    // The value on the wire, not the value on screen. `provision_organization`
    // has its own `default false`, so an omitted key would provision correctly
    // TODAY and stop doing so the day one of the two defaults moves — a bug with
    // no symptom until a purge reads the registry.
    const user = await renderConsole();
    await fillProvisionForm(user, CUSTOMER);

    await user.click(screen.getByTestId("provision"));

    await waitFor(() => expect(provisionOrganization).toHaveBeenCalledTimes(1));
    const sent = provisionArg();
    // The key first and the value second, deliberately: "the console sent
    // nothing" and "the console sent the wrong thing" are different defects, and
    // asserting the keys makes the failure print what WAS sent.
    expect(Object.keys(sent)).toContain("isTest");
    expect(sent.isTest).toBe(false);
    // And the mark went out attached to the right customer, not on its own.
    expect(sent).toMatchObject({
      organizationName: CUSTOMER.name,
      slug: CUSTOMER.slug,
      adminEmail: CUSTOMER.email,
    });
  });

  it("sends isTest true when the box is checked", async () => {
    const user = await renderConsole();
    await fillProvisionForm(user, REHEARSAL);

    await user.click(testBox());
    expect(testBox()).toBeChecked();
    await user.click(screen.getByTestId("provision"));

    await waitFor(() => expect(provisionOrganization).toHaveBeenCalledTimes(1));
    expect(provisionArg().isTest).toBe(true);
    expect(provisionArg()).toMatchObject({ organizationName: REHEARSAL.name });
  });

  it("puts the box back down after a workspace is created, so the next customer is not marked", async () => {
    // THE WORST THING THIS SCREEN COULD DO. Provisioning is a repeated action
    // from one form that is never remounted, so a checkbox that stayed checked
    // would mark the NEXT workspace as well — and the next workspace is a real
    // customer, who then sits on the allow-list a purge deletes from. There is
    // nothing on the customer's screen, or in the product's behaviour, that
    // would ever reveal it.
    //
    // The second provision is the assertion. An unchecked box on screen and a
    // `false` on the wire are two different claims, and only the second one is
    // what the registry stores.
    const user = await renderConsole();

    await fillProvisionForm(user, REHEARSAL);
    await user.click(testBox());
    await user.click(screen.getByTestId("provision"));
    await waitFor(() => expect(provisionOrganization).toHaveBeenCalledTimes(1));
    expect(provisionArg(0).isTest).toBe(true);

    // The form emptied, and the mark came off with the rest of it.
    await waitFor(() => expect(screen.getByLabelText("Company name")).toHaveValue(""));
    expect(testBox()).not.toBeChecked();

    // Now a real customer, typed into the same form by somebody who has no
    // reason to look at a checkbox they never touched.
    await fillProvisionForm(user, CUSTOMER);
    await user.click(screen.getByTestId("provision"));

    await waitFor(() => expect(provisionOrganization).toHaveBeenCalledTimes(2));
    const second = provisionArg(1);
    expect(second).toMatchObject({ organizationName: CUSTOMER.name, adminEmail: CUSTOMER.email });
    expect(second.isTest).toBe(false);
  });

  it("keeps the mark when the workspace was refused, so the retry creates what was asked for", async () => {
    // The other half of the reset, and the reason it lives on the success path
    // rather than in a `finally`. Nothing was created, so the form still
    // describes the thing that is about to be submitted again — and a mark that
    // silently came off during a refused attempt would produce an unmarked test
    // workspace on the retry, with the person believing they had marked it.
    vi.mocked(provisionOrganization).mockRejectedValueOnce(
      new AppError("SLUG_TAKEN", "That workspace address is already taken.", 400, {
        field: "slug",
      }),
    );

    const user = await renderConsole();
    await fillProvisionForm(user, REHEARSAL);
    await user.click(testBox());
    await user.click(screen.getByTestId("provision"));

    expect(await screen.findByTestId("provision-error")).toHaveTextContent(
      "That workspace address is already taken.",
    );
    // Every field still describes the same workspace, the mark included.
    expect(screen.getByLabelText("Company name")).toHaveValue(REHEARSAL.name);
    expect(screen.getByLabelText("Administrator email")).toHaveValue(REHEARSAL.email);
    expect(testBox()).toBeChecked();

    // The retry, with the one thing that was actually wrong put right.
    const slugField = screen.getByLabelText("Workspace address");
    await user.clear(slugField);
    await user.type(slugField, "neuvto-rehearsal-2");
    await user.click(screen.getByTestId("provision"));

    await waitFor(() => expect(provisionOrganization).toHaveBeenCalledTimes(2));
    expect(provisionArg(1)).toMatchObject({ slug: "neuvto-rehearsal-2", isTest: true });
  });

  it("names the checkbox to whoever cannot see it", async () => {
    // Sada raised this exact class on the demo form on 8 Aug 2026: five labels,
    // none of them attached to anything, so every field announced as "edit text,
    // blank". A checkbox is worse than a text box when it happens — there is no
    // typed value to give it away, only a box that says nothing about what
    // ticking it does.
    await renderConsole();

    const box = testBox();
    // The accessible name, computed the way a screen reader computes it. This
    // fails if the label is not attached by ANY means.
    expect(screen.getByRole("checkbox", { name: /This is an internal test workspace/ })).toBe(box);
    expect(screen.getByLabelText(/This is an internal test workspace/)).toBe(box);

    // …and attached explicitly, not only by wrapping. `htmlFor`/`id` is the
    // convention this project's forms are written to, and it survives the label
    // being moved out of the wrapper by a later layout change.
    expect(box.id).toBe("is-test");
    expect(box.closest("label")).toHaveAttribute("for", "is-test");

    // Clicking the words, which is what a person does — the box itself is 16px.
    const user = userEvent.setup();
    await user.click(screen.getByText("This is an internal test workspace"));
    expect(box).toBeChecked();
  });
});

/**
 * One workspace's row.
 *
 * By row rather than by page: the negative assertions are the ones that matter
 * here, and `queryByTestId("test-badge")` against the whole page passes happily
 * while the badge sits on the wrong customer.
 */
function rowFor(name: string): HTMLElement {
  const rows = screen.getAllByTestId("customer-row").filter((r) => r.textContent?.includes(name));
  if (rows.length !== 1) {
    throw new Error(`expected exactly one workspace row for "${name}", found ${rows.length}`);
  }
  return rows[0];
}

describe("Neuvto console — which workspaces are marked, in the list", () => {
  it("badges the test workspace and leaves the customer alone", async () => {
    await renderConsole();
    expect(screen.getAllByTestId("customer-row")).toHaveLength(ORGS.length);

    const vistara = within(rowFor("Vistara Facilities")).getByTestId("test-badge");
    expect(vistara).toHaveTextContent("Test");

    // THE ASSERTION THIS BLOCK IS FOR. Acme is a real customer. A badge here
    // says Neuvto owns them, and it is the list Sada reads before naming
    // workspaces to delete.
    const acme = rowFor("Acme Security Services");
    expect(within(acme).queryByTestId("test-badge")).toBeNull();
    // Nothing else on the row calls them a test either — a badge rendered
    // without the test id would slip past the query above. Matched exactly, so
    // the row's own "Mark as test" button is not what satisfies it.
    expect(within(acme).queryByText("Test")).toBeNull();
  });

  it("says why it was marked, without a purge being the thing that tells you", async () => {
    await renderConsole();

    const badge = within(rowFor("Vistara Facilities")).getByTestId("test-badge");
    expect(badge).toHaveAttribute("title", ORGS[1].testReason);
  });

  it("shows no badges at all in a list of real customers", async () => {
    // The ordinary state of this screen once there are customers. A badge that
    // renders for everybody is indistinguishable from a badge that works, in a
    // list where every row happens to be a test workspace.
    vi.mocked(listOrganizations).mockResolvedValue(
      ORGS.map((o) => ({ ...o, isTest: false, testReason: null })),
    );

    await renderConsole();

    expect(screen.getAllByTestId("customer-row")).toHaveLength(ORGS.length);
    expect(screen.queryAllByTestId("test-badge")).toHaveLength(0);
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Marking and unmarking a workspace that already exists
 *
 * The checkbox on the provisioning form only covers workspaces created from now
 * on. The one already in production predates the registry, and the migration
 * deliberately refuses to backfill it — a migration cannot tell whether it woke
 * up in a world where every existing row is a rehearsal or one where a real
 * customer has appeared since it was written. A person can. These are the
 * controls that person uses.
 *
 * ── the asymmetry, and why the tests are not symmetrical either
 *
 * Unmarking is ONE CLICK. Removing a marking can only make a future purge refuse
 * more, and it is the correction somebody reaches for having just realised a real
 * customer was ticked; nothing about that should be slow.
 *
 * Marking demands a typed reason first. A single click must never be able to put
 * a customer on the allow-list a purge deletes from — so the test that matters
 * most in this block is the one that presses "Mark as test" and proves that
 * NOTHING was written.
 *
 * I was asked to say if I thought the asymmetry was wrong. I do not. It puts the
 * friction on the irreversible direction and none on the corrective one, and the
 * reason the database demands anyway is collected at the only moment anybody
 * still knows the answer.
 */
describe("Neuvto console — marking a workspace that already exists", () => {
  /** Acme is the real customer. This is the button that could ruin them. */
  const ACME = ORGS[0];
  /** Vistara is already marked. */
  const VISTARA = ORGS[1];

  it("offers each row the one direction that applies to it", async () => {
    await renderConsole();

    const acme = rowFor(ACME.name);
    expect(within(acme).getByTestId("mark-test")).toHaveTextContent("Mark as test");
    expect(within(acme).queryByTestId("unmark-test")).toBeNull();

    const vistara = rowFor(VISTARA.name);
    expect(within(vistara).getByTestId("unmark-test")).toHaveTextContent("Not a test");
    expect(within(vistara).queryByTestId("mark-test")).toBeNull();

    // And no reason field is open anywhere until somebody asks for one.
    expect(screen.queryAllByTestId("mark-reason")).toHaveLength(0);
  });

  it("removes a marking in one click, and re-reads the list rather than trusting the click", async () => {
    // One click on purpose. The badge still comes from the database afterwards —
    // a locally-flipped row would show a correction that never persisted, on the
    // list somebody is about to name workspaces to delete from.
    const user = await renderConsole();
    expect(listOrganizations).toHaveBeenCalledTimes(1);

    await user.click(within(rowFor(VISTARA.name)).getByTestId("unmark-test"));

    await waitFor(() => expect(unmarkTestOrganization).toHaveBeenCalledTimes(1));
    expect(unmarkTestOrganization).toHaveBeenCalledWith(VISTARA.id);
    // Vistara's id, not Acme's. The two rows differ in every other respect, so a
    // handler wired to the wrong row would still look plausible on screen.
    expect(unmarkTestOrganization).not.toHaveBeenCalledWith(ACME.id);
    await waitFor(() => expect(listOrganizations).toHaveBeenCalledTimes(2));
    // No confirmation step, so nothing was asked before the write.
    expect(markTestOrganization).not.toHaveBeenCalled();
  });

  it("writes nothing when the button that opens the reason field is pressed", async () => {
    // THE ASSERTION THIS BLOCK EXISTS FOR. "Mark as test" on a real customer's
    // row is the one control on this screen that can put somebody on a deletion
    // allow-list. It must open a form and do nothing else — no write, no reload,
    // no badge.
    const user = await renderConsole();

    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));

    expect(markTestOrganization).not.toHaveBeenCalled();
    expect(listOrganizations).toHaveBeenCalledTimes(1);
    expect(within(rowFor(ACME.name)).queryByTestId("test-badge")).toBeNull();

    // What it did do: opened the reason field on that row and only that row.
    expect(screen.getAllByTestId("mark-reason")).toHaveLength(1);
    expect(within(rowFor(ACME.name)).getByTestId("mark-reason")).toHaveFocus();
    // …and the same button now offers the way back out.
    expect(within(rowFor(ACME.name)).getByTestId("mark-test")).toHaveTextContent("Cancel");
  });

  it("marks with the reason that was typed, re-reads, and closes the form", async () => {
    // The reload is what makes the badge true rather than optimistic, so the
    // second read returns what the database would: Acme, now marked.
    const REASON = "Approval chains, Aug 2026";
    const AFTER = [{ ...ACME, isTest: true, testReason: REASON }, VISTARA];
    vi.mocked(listOrganizations).mockResolvedValueOnce(ORGS).mockResolvedValue(AFTER);

    const user = await renderConsole();
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    await user.type(screen.getByTestId("mark-reason"), REASON);
    await user.click(screen.getByTestId("mark-confirm"));

    await waitFor(() => expect(markTestOrganization).toHaveBeenCalledTimes(1));
    expect(markTestOrganization).toHaveBeenCalledWith(ACME.id, REASON);
    await waitFor(() => expect(listOrganizations).toHaveBeenCalledTimes(2));

    // The form is gone and the badge is there, carrying the reason that was
    // typed — read back from the list, not from the input.
    await waitFor(() => expect(screen.queryByTestId("mark-reason")).toBeNull());
    const badge = within(rowFor(ACME.name)).getByTestId("test-badge");
    expect(badge).toHaveTextContent("Test");
    expect(badge).toHaveAttribute("title", REASON);
    // The row now offers the correction instead of the marking.
    expect(within(rowFor(ACME.name)).getByTestId("unmark-test")).toBeInTheDocument();
  });

  it("hands a reason of pure whitespace to the guard exactly as typed, and shows the refusal", async () => {
    // A tab and a zero-width space are the two that defeated the original
    // `btrim` guard, so they are the two used here. What the COMPONENT owes is
    // narrow and worth stating: pass the string through untouched. A component
    // that trimmed it to "" and skipped the call, or trimmed it and sent "",
    // would take the decision away from the layer that is allowed to make it.
    //
    // The rule itself — which strings count as an answer — lives in
    // `markTestOrganization`, which is replaced by this file's mock. It is NOT
    // under test here; see the report.
    const REFUSAL = "Say what this workspace is for.";
    vi.mocked(markTestOrganization).mockRejectedValue(
      new AppError("VALIDATION_FAILED", REFUSAL, 400, { field: "reason" }),
    );

    const user = await renderConsole();

    for (const blank of ["\t", "​"]) {
      await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
      const field = screen.getByTestId("mark-reason");
      await user.click(field);
      // Pasted, not typed: `user.type` reads "{" and "[" as key syntax and a tab
      // as a focus move, and neither would put the character in the box.
      await user.paste(blank);
      expect(field).toHaveValue(blank);

      await user.click(screen.getByTestId("mark-confirm"));

      await waitFor(() => expect(markTestOrganization).toHaveBeenCalledWith(ACME.id, blank));
      // Refused, so nothing was written and nothing was re-read.
      expect(listOrganizations).toHaveBeenCalledTimes(1);
      expect(within(rowFor(ACME.name)).queryByTestId("test-badge")).toBeNull();
      // The refusal is on screen in its own words, INSIDE THE ROW it is about.
      //
      // It used to render in the provisioning panel at the top of the page,
      // because `error` was one shared state with a single render site inside
      // the "New customer" form. So refusing a reason typed halfway down the
      // list put "Say what this workspace is for." directly above "Create
      // workspace and invite", where it reads as a refusal of provisioning.
      // `within(row)` is the whole point of this assertion — a page-level
      // `findByRole` passed throughout that defect.
      expect(await within(rowFor(ACME.name)).findByRole("alert")).toHaveTextContent(REFUSAL);
      // And the field is still open holding what was typed, so the person can
      // see the thing that was refused.
      expect(screen.getByTestId("mark-reason")).toHaveValue(blank);

      vi.mocked(markTestOrganization).mockClear();
      await user.click(within(rowFor(ACME.name)).getByTestId("mark-test")); // Cancel
    }
  });

  it("takes the refusal away with the form that caused it", async () => {
    // The refusal used to outlive its form: close the row and the sentence
    // stayed, at the top of the page, now describing nothing on screen. With
    // `role="alert"` a screen reader announced it with no clue which of the two
    // forms it belonged to.
    const REFUSAL = "Say what this workspace is for.";
    vi.mocked(markTestOrganization).mockRejectedValue(
      new AppError("VALIDATION_FAILED", REFUSAL, 400, { field: "reason" }),
    );

    const user = await renderConsole();
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    await user.click(screen.getByTestId("mark-reason"));
    await user.paste("\t");
    await user.click(screen.getByTestId("mark-confirm"));
    expect(await within(rowFor(ACME.name)).findByRole("alert")).toHaveTextContent(REFUSAL);

    // Cancel.
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));

    expect(screen.queryByTestId("mark-reason")).toBeNull();
    expect(screen.queryByTestId("mark-error")).toBeNull();
    // And nowhere else on the page either — this is the assertion that would
    // have caught it rendering in the provisioning panel.
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it("will not let Cancel close a form whose write is already on its way", async () => {
    // Cancel used to stay enabled during the request. Press it inside that
    // window and the form closed while the write still landed — a badge on a
    // workspace somebody had just said no to, which is the dangerous direction.
    let release: (() => void) | undefined;
    vi.mocked(markTestOrganization).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const user = await renderConsole();
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    await user.click(screen.getByTestId("mark-reason"));
    await user.paste("Balance carry-forward, Aug 2026");
    await user.click(screen.getByTestId("mark-confirm"));

    await waitFor(() => expect(markTestOrganization).toHaveBeenCalledTimes(1));
    expect(within(rowFor(ACME.name)).getByTestId("mark-test")).toBeDisabled();
    expect(screen.getByTestId("mark-confirm")).toBeDisabled();

    release?.();
    await waitFor(() => expect(listOrganizations).toHaveBeenCalledTimes(2));
  });

  it("does not close one row's form because another row finished saving", async () => {
    // `markBusy` was keyed by row; `markingFor` and `markReason` were not. So a
    // write on Vistara cleared the form open on Acme and discarded what had been
    // typed into it — the same class of bug the keying exists to prevent, with
    // one of the three pieces of state left unkeyed.
    let release: (() => void) | undefined;
    vi.mocked(markTestOrganization).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    // Three workspaces so two can be unmarked at once.
    const THIRD = { ...ACME, id: "c3d4e5f6-1111-4222-8333-444455556666", name: "Third Co" };
    vi.mocked(listOrganizations).mockResolvedValue([ACME, THIRD, VISTARA]);

    const user = await renderConsole();

    // Start a write on Acme, and leave it in flight.
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    await user.click(screen.getByTestId("mark-reason"));
    await user.paste("Acme reason");
    await user.click(screen.getByTestId("mark-confirm"));
    await waitFor(() => expect(markTestOrganization).toHaveBeenCalledTimes(1));

    // Open the other row and type into it while Acme's write is still going.
    await user.click(within(rowFor(THIRD.name)).getByTestId("mark-test"));
    await user.click(screen.getByTestId("mark-reason"));
    await user.paste("Third reason");

    release?.();
    await waitFor(() => expect(listOrganizations).toHaveBeenCalledTimes(2));

    // Third's form is still open, still holding what was typed into it.
    expect(within(rowFor(THIRD.name)).getByTestId("mark-reason")).toHaveValue("Third reason");
  });

  it("keeps the form and the typed reason after a refused write, so the retry sends it again", async () => {
    // The bug shape this project has already been bitten by, in the other
    // direction: a refusal that outlived its request. Here the risk is the
    // opposite — a refusal that takes the person's typing with it, so the retry
    // sends something they did not check.
    const REASON = "Balance carry-forward, Aug 2026";
    vi.mocked(markTestOrganization).mockRejectedValueOnce(
      new AppError("INTERNAL_ERROR", "The marking could not be saved.", 500),
    );

    const user = await renderConsole();
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    await user.type(screen.getByTestId("mark-reason"), REASON);
    await user.click(screen.getByTestId("mark-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("The marking could not be saved.");
    expect(screen.getByTestId("mark-reason")).toHaveValue(REASON);
    expect(screen.getByTestId("mark-confirm")).toBeEnabled();
    expect(within(rowFor(ACME.name)).queryByTestId("test-badge")).toBeNull();

    // The retry, without retyping anything.
    await user.click(screen.getByTestId("mark-confirm"));

    await waitFor(() => expect(markTestOrganization).toHaveBeenCalledTimes(2));
    expect(vi.mocked(markTestOrganization).mock.calls[1]).toEqual([ACME.id, REASON]);
  });

  it("says which row it is saving, and says it on no other row", async () => {
    // `markBusy` holds a row id rather than a boolean for exactly this reason. A
    // shared flag disables every row's control at once, which on a list of
    // customers reads as the whole screen having seized up — and it invites the
    // person to click the row that looks stuck.
    //
    // Two MARKED rows, because the two directions render different controls and
    // a pair of identical ones is the only arrangement in which the keying can be
    // observed at all.
    const OTHER = {
      ...VISTARA,
      id: "c4e81f37-6a02-4d95-8b13-9f5a7e0c2d61",
      name: "Meridian Estates",
      slug: "meridian",
      isTest: true,
      testReason: "Second rehearsal, approvals",
    };
    vi.mocked(listOrganizations).mockResolvedValue([ACME, VISTARA, OTHER]);

    let release!: () => void;
    vi.mocked(unmarkTestOrganization).mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const user = await renderConsole();
    await waitFor(() => expect(screen.getAllByTestId("unmark-test")).toHaveLength(2));

    await user.click(within(rowFor(VISTARA.name)).getByTestId("unmark-test"));

    const busy = within(rowFor(VISTARA.name)).getByTestId("unmark-test");
    expect(busy).toHaveTextContent("Saving…");
    expect(busy).toBeDisabled();

    // The other rehearsal is untouched — still readable, still clickable.
    const idle = within(rowFor(OTHER.name)).getByTestId("unmark-test");
    expect(idle).toHaveTextContent("Not a test");
    expect(idle).toBeEnabled();

    // Settled on the button's own label rather than on the reload, so this test
    // fails for one reason only — the keying — and not because `unmark` stopped
    // re-reading the list. That is the test above's job.
    release();
    await waitFor(() =>
      expect(within(rowFor(VISTARA.name)).getByTestId("unmark-test")).toHaveTextContent(
        "Not a test",
      ),
    );
  });

  it("names the reason field, and names it per row", async () => {
    // Sada's 8 Aug defect class again, on a field that is harder to guess at than
    // most: "Approval chains, Aug 2026" next to an unnamed box says nothing about
    // which workspace it is about to mark.
    const SECOND = {
      ...ACME,
      id: "9d2f5b81-3c47-4e60-a5d9-1b8e6f0a4c73",
      name: "Kanha Logistics",
      slug: "kanha",
      isTest: false,
      testReason: null,
    };
    vi.mocked(listOrganizations).mockResolvedValue([ACME, SECOND]);

    const user = await renderConsole();

    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    const acmeField = screen.getByTestId("mark-reason");
    // The label names the workspace, so the field cannot be read as being about
    // the row above or below it.
    expect(screen.getByLabelText(`What is ${ACME.name} being used to test?`)).toBe(acmeField);
    expect(acmeField.closest("form")?.querySelector("label")).toHaveAttribute(
      "for",
      acmeField.id, // id and htmlFor agree, not merely both present
    );
    expect(acmeField.id).toContain(ACME.id);

    // Close it and open the other row's: a different id, from a different row.
    await user.click(within(rowFor(ACME.name)).getByTestId("mark-test"));
    await user.click(within(rowFor(SECOND.name)).getByTestId("mark-test"));

    const secondField = screen.getByTestId("mark-reason");
    expect(screen.getByLabelText(`What is ${SECOND.name} being used to test?`)).toBe(secondField);
    expect(secondField.id).toContain(SECOND.id);
    expect(secondField.id).not.toBe(acmeField.id);
  });
});

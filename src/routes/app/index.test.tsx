// @vitest-environment happy-dom

/**
 * The dashboard's role line, and the one copy of ROLE_LABELS that would have
 * shipped broken.
 *
 * There were four copies of the role-label map. Three were typed
 * `Record<AppRole, string>` and failed typecheck the moment `supervisor` and
 * `coordinator` were added to APP_ROLES — the compiler named the file and the
 * missing key. This one was `Record<string, string>`, so it compiled perfectly
 * and looked up a key that was not there.
 *
 * What it degrades to is what makes it worth a test rather than a type. The
 * line reads `ROLE_LABELS[r] ?? r`, so a Supervisor was never going to see a
 * blank — they were going to see the lower-case database value `supervisor`
 * sitting under their own name, which reads as the app leaking its schema at
 * somebody. Nothing errors, nothing is logged, and the only person who finds it
 * is the first Supervisor to sign in.
 *
 * The second half of D57 is also on this screen: these two roles APPROVE and do
 * not ADMINISTER. `isAdmin` and `canApprove` are the REAL functions here, not
 * stubs, because a stub would let this file assert that a Supervisor is kept out
 * of Administration while the app let them in.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AppRole, CurrentUser } from "@/platform/auth";

// ── the seam
//
// The router (reached at module load) and the two data calls the component
// makes on mount. Everything the component decides for itself is left alone.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  // An anchor, not a passthrough. A `Link` that renders its children bare
  // collapses three separate destinations into one run of text, and then a test
  // asking "is People offered?" is really asking "does the string appear
  // somewhere on the page" — which a paragraph mentioning People would satisfy.
  Link: ({ to, children }: { to?: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const getCurrentUser = vi.fn<() => Promise<CurrentUser | null>>();

vi.mock("@/platform/auth", async () => {
  // Real labels and real role helpers. `contracts` imports only zod; `session`
  // imports the Supabase client, but that client is a lazy Proxy which
  // constructs nothing until a query is actually made — so neither drags a
  // network dependency into this file.
  const { ROLE_LABELS } = await import("@/platform/auth/contracts");
  const { isAdmin, canApprove } = await import("@/platform/auth/session");
  return { ROLE_LABELS, isAdmin, canApprove, getCurrentUser: () => getCurrentUser() };
});

// The dashboard names no module (that is the point of the module contract), so
// an empty list is the honest default and keeps these tests about the role line.
const getDashboardCards = vi.fn<(user: CurrentUser | null) => Promise<unknown[]>>(async () => []);
vi.mock("@/platform/modules", () => ({
  getDashboardCards: (u: CurrentUser | null) => getDashboardCards(u),
}));

import { Route } from "./index";

/**
 * `Dashboard` is not exported — only `Route` is — so it is reached through the
 * route options object, which the mocked `createFileRoute` above returns
 * verbatim. members.tsx exports its component for exactly this reason and is
 * the tidier pattern; noted rather than changed, since this file may not touch
 * component source.
 */
const Dashboard = (Route as unknown as { component: () => React.ReactElement }).component;

const userWith = (roles: AppRole[]): CurrentUser => ({
  id: "sunita-id",
  email: "sunita.kapoor@acme.test",
  fullName: "Sunita Kapoor",
  organizationId: "org",
  organizationName: "Acme",
  roles,
});

/** The line under the greeting. Located by position, so no test id is invented. */
async function roleLine(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 1 });
  return heading.nextElementSibling as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDashboardCards.mockResolvedValue([]);
});

describe("Dashboard — the role line", () => {
  it("calls a Supervisor a Supervisor, not `supervisor`", async () => {
    // THE ONE THAT WOULD HAVE SHIPPED. Exact equality rather than a contains:
    // `toHaveTextContent("Supervisor")` is a substring match, and the fallback
    // this is guarding against differs from the right answer only by a capital
    // letter.
    getCurrentUser.mockResolvedValue(userWith(["supervisor"]));
    render(<Dashboard />);

    expect((await roleLine()).textContent).toBe("Supervisor");
  });

  it("calls a Coordinator a Coordinator", async () => {
    getCurrentUser.mockResolvedValue(userWith(["coordinator"]));
    render(<Dashboard />);

    expect((await roleLine()).textContent).toBe("Coordinator");
  });

  it("labels every role somebody holds, not just the first", async () => {
    // Two roles is ordinary — an HR administrator who also approves for her own
    // team. A map missing one key leaves half the sentence as a raw value, which
    // is harder to spot than a whole line of them.
    getCurrentUser.mockResolvedValue(userWith(["hr_admin", "coordinator"]));
    render(<Dashboard />);

    expect((await roleLine()).textContent).toBe("HR administrator · Coordinator");
  });

  it("says it is still loading rather than naming no role at all", async () => {
    // Two different nothings. "Loading your access…" and an empty role line are
    // different answers, and a person whose roles genuinely failed to load
    // should not be told they have none.
    getCurrentUser.mockResolvedValue(null);
    render(<Dashboard />);

    expect(await screen.findByText("Loading your access…")).toBeInTheDocument();
  });
});

describe("Dashboard — approving is not administering", () => {
  it("does not offer Settings, People or Approval rules to a Supervisor", async () => {
    // D57's whole point. A Supervisor signs off leave for their own reports and
    // administers nothing — every one of these three screens is is_admin() in
    // the database and would refuse them, so offering the link promises
    // something the app then takes away.
    getCurrentUser.mockResolvedValue(userWith(["supervisor"]));
    render(<Dashboard />);
    await roleLine();

    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("link", { name: "People" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Approval rules" })).toBeNull();
    expect(screen.queryByText("Administration")).toBeNull();

    // …but they are told where their team's requests turn up, which is the only
    // thing the role actually gets them.
    expect(screen.getByText(/Requests from your team will appear under/)).toBeInTheDocument();
  });

  it("still offers all three to an administrator", async () => {
    // The other side of the gate. Without this, hiding the section from
    // everybody would pass the test above.
    getCurrentUser.mockResolvedValue(userWith(["org_admin"]));
    render(<Dashboard />);
    await roleLine();

    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/app/members");
    expect(screen.getByRole("link", { name: "Approval rules" })).toHaveAttribute(
      "href",
      "/app/approval-rules",
    );
  });

  it("tells an Employee about neither", async () => {
    // Somebody who can neither administer nor approve gets no admin section and
    // no promise of a queue that will never have anything in it.
    getCurrentUser.mockResolvedValue(userWith(["employee"]));
    render(<Dashboard />);
    await roleLine();

    expect(screen.queryByText("Administration")).toBeNull();
    expect(screen.queryByText(/Requests from your team will appear under/)).toBeNull();
  });
});

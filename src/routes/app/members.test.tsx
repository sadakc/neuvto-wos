// @vitest-environment happy-dom

/**
 * The first render test in this project, and it exists because of a specific
 * bug.
 *
 * Searching for one person on the People screen changed every "Reports to"
 * field to "Nobody". Nothing was written and the database never changed — the
 * dropdown's options had been built from the SEARCH-FILTERED list, so the
 * option for somebody's actual manager no longer existed, and a <select> whose
 * value is absent from its options renders the first one instead.
 *
 * Sada found it by using the app. Nothing else could have: `bun run lint`,
 * `bun run typecheck`, 123 unit tests and the full SQL harness were all green,
 * because every test in this project was a pure function and the entire class
 * of "the control is lying about saved state" lives above them.
 *
 * That is what this file is for. Not coverage — the specific promise that a
 * control on screen reports what is actually stored.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppError } from "@/platform/errors";

// ── the seam
//
// members.tsx reaches for the router at module load and for the database on
// mount. Both are replaced here so the test is about the component's own logic:
// given these people and this search, what does it show?

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock("@/platform/auth/InviteTeam", () => ({
  InviteTeam: () => null,
}));

const MARK = "mark-id";
const RAVI = "ravi-id";
const PRIYA = "priya-id";
const SUNITA = "sunita-id";
const ALICE = "alice-id";

const MEMBERS = [
  {
    id: ALICE,
    // The signed-in administrator is in her own People list, which is what a
    // real workspace looks like — and her role is the one whose LABEL and whose
    // database value share no letters, so a search for "Administrator" tells
    // "matches the label" apart from "matches the enum".
    fullName: "Alice Admin",
    email: "alice.admin@acme.test",
    phone: null,
    joinedDate: "2019-01-01",
    isActive: true,
    managerId: null,
    roles: ["org_admin"],
  },
  {
    id: MARK,
    fullName: "Mark Manager",
    email: "mark.manager@acme.test",
    phone: null,
    joinedDate: "2020-01-01",
    isActive: true,
    managerId: null,
    roles: ["manager"],
  },
  {
    id: SUNITA,
    // D57. A Supervisor approves and does not administer, and — the part that
    // matters on this screen — she is allowed people underneath her. Nobody is
    // NAMED "Supervisor", so a search for the word can only be matching a role.
    fullName: "Sunita Kapoor",
    email: "sunita.kapoor@acme.test",
    phone: null,
    joinedDate: "2019-04-01",
    isActive: true,
    managerId: null,
    roles: ["supervisor"],
  },
  {
    id: RAVI,
    fullName: "Ravi Employee",
    email: "ravi.emp@acme.test",
    phone: null,
    joinedDate: "2021-06-15",
    isActive: true,
    // The whole point: Ravi reports to Mark, and a search for "ravi" removes
    // Mark from the list.
    managerId: MARK,
    roles: ["employee"],
  },
  {
    id: PRIYA,
    fullName: "Priya Employee",
    email: "priya.emp@acme.test",
    phone: null,
    joinedDate: "2022-03-01",
    isActive: true,
    // Reports to the Supervisor, not to the Manager. This is the arrangement
    // D57 exists to permit, so it is the one the fixture should contain.
    managerId: SUNITA,
    roles: ["employee"],
  },
];

vi.mock("@/platform/auth", async () => ({
  // The REAL labels, not a stub. They are what the search box matches on —
  // somebody typing "Administrator" is searching for a role, not for
  // `org_admin` — so a fake map here would make these tests agree with
  // themselves and with nothing else. Pulled from `contracts`, which imports
  // only zod, rather than from the barrel, which would drag in the Supabase
  // client this mock exists to avoid.
  ROLE_LABELS: (await import("@/platform/auth/contracts")).ROLE_LABELS,
  getCurrentUser: async () => ({
    id: "alice-id",
    email: "alice.admin@acme.test",
    fullName: "Alice Admin",
    organizationId: "org",
    organizationName: "Acme",
    roles: ["org_admin"],
  }),
  isAdmin: () => true,
  listMembers: async () => MEMBERS,
  listInvitations: async () => [],
  deactivateMember: vi.fn(),
  deactivationImpact: vi.fn(),
  reactivateMember: vi.fn(),
  revokeInvitation: vi.fn(),
  setJoinedDate: vi.fn(),
  setReportingLine: vi.fn(),
}));

import { MembersPage } from "./members";
// The same mocked functions the component imports, so a test can decide what
// the database says back.
import { deactivateMember, deactivationImpact, setReportingLine } from "@/platform/auth";

async function renderPeople() {
  render(<MembersPage />);
  // The page loads its data on mount; wait for the skeleton to give way.
  expect(await screen.findByText("In this workspace")).toBeInTheDocument();
}

/**
 * One person's row, found by the name printed on it.
 *
 * Not `getByText(name).closest(…)`. Every name appears as an `<option>` in every
 * other row's "Reports to" dropdown — which is the whole reason this file exists
 * — so a plain text query matches five rows and silently returns the first. The
 * dropdowns are removed before the row is matched, which is structure-
 * independent and says out loud what is being ignored.
 */
function rowFor(name: string): HTMLElement {
  const rows = screen.getAllByTestId("member-row").filter((row) => {
    const withoutDropdowns = row.cloneNode(true) as HTMLElement;
    withoutDropdowns.querySelectorAll("select").forEach((s) => s.remove());
    return (withoutDropdowns.textContent ?? "").includes(name);
  });
  if (rows.length !== 1) {
    throw new Error(`expected exactly one member row for "${name}", found ${rows.length}`);
  }
  return rows[0];
}

describe("People — search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still reports the right manager when the manager is filtered out", async () => {
    // THE REGRESSION. Before the fix this select rendered "Nobody", because
    // Mark was not among its options and a <select> falls back to the first.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "ravi");

    const rows = screen.getAllByTestId("member-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Ravi Employee")).toBeInTheDocument();

    const select = within(rows[0]).getByTestId("reporting-line") as HTMLSelectElement;
    expect(select.value).toBe(MARK);
    // And the option is genuinely present — a value alone would pass even if
    // the browser were rendering a blank.
    expect(within(select).getByRole("option", { name: "Mark Manager" })).toBeInTheDocument();
    expect(select.selectedOptions[0].textContent).toBe("Mark Manager");
  });

  it("offers every active person as a manager, not just the ones matching", async () => {
    // The same fault seen from the other side: an administrator who searches to
    // FIND somebody must still be able to give them any manager.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "ravi");

    const select = within(screen.getAllByTestId("member-row")[0]).getByTestId("reporting-line");
    const names = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toContain("Mark Manager");
    expect(names).toContain("Priya Employee");
    // Never themselves — that is a reporting loop.
    expect(names).not.toContain("Ravi Employee");
  });

  it("narrows the list as you type, and matches on email as well as name", async () => {
    const user = userEvent.setup();
    await renderPeople();

    expect(screen.getAllByTestId("member-row")).toHaveLength(MEMBERS.length);

    await user.type(screen.getByTestId("people-search"), "priya.emp@");
    expect(screen.getAllByTestId("member-row")).toHaveLength(1);
    expect(screen.getByText("Priya Employee")).toBeInTheDocument();
  });

  it("says nothing matched rather than showing an empty list", async () => {
    // "No people" and "no people called Zebedee" are different answers, and the
    // second one is usually a typo.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "zebedee");
    expect(screen.getByTestId("people-no-match")).toBeInTheDocument();
    expect(screen.queryAllByTestId("member-row")).toHaveLength(0);
  });

  it("is present without waiting for the workspace to get big", async () => {
    // It was briefly hidden below nine people, which put it one person under
    // the threshold in the first workspace it met and read as missing.
    await renderPeople();
    expect(screen.getByTestId("people-search")).toBeInTheDocument();
  });
});

/**
 * D57 — the two new roles, on the screen that names everybody's.
 *
 * This screen had its own copy of ROLE_LABELS. What that copy degrades to here
 * is not a blank: the row renders
 * `m.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Employee"`, and a map with
 * no `supervisor` key produces `[undefined].join(", ")` — the empty string —
 * which falls through the `||` to the literal word **Employee**. A Supervisor's
 * row would confidently describe her as an Employee, which is the exact opposite
 * of what her role means, and there is nothing on the page to notice.
 */
describe("People — role labels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names a Supervisor on her own row, and does not call her an Employee", async () => {
    await renderPeople();

    const sunita = rowFor("Sunita Kapoor");
    expect(within(sunita).getByText("Supervisor")).toBeInTheDocument();
    // The specific wrong answer, named. `queryByText("Employee")` is scoped to
    // this row, so Ravi and Priya being employees does not mask it.
    expect(within(sunita).queryByText("Employee")).toBeNull();
  });

  it("finds somebody by the role they hold, typed the way it is written on screen", async () => {
    // The search matches through ROLE_LABELS, not through the enum. Nobody in
    // this workspace is called Sunita Supervisor.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "Supervisor");

    const rows = screen.getAllByTestId("member-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Sunita Kapoor")).toBeInTheDocument();
  });

  it("matches the label rather than the database value behind it", async () => {
    // "supervisor" is a word that appears in both, so it proves nothing on its
    // own. `org_admin` and "Administrator" share no substring at all — this is
    // the search that can only pass if the label is what is being read.
    const user = userEvent.setup();
    await renderPeople();

    await user.type(screen.getByTestId("people-search"), "Administrator");

    const rows = screen.getAllByTestId("member-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText(/Alice Admin/)).toBeInTheDocument();
  });
});

/**
 * D57 — the refusal, once it has left the database.
 *
 * Naming an Employee as somebody's manager is now refused, because leave is
 * approved by whoever a person reports to and an Employee cannot approve. The
 * screen has to say why, and say what to do about it.
 *
 * The honest limit of this file: `@/platform/auth` is mocked, so the mapping
 * from the database's `MANAGER_CANNOT_APPROVE` to this sentence — which lives
 * in `platform/auth/members.ts` — is NOT what is under test here. What is under
 * test is that a refusal thrown by `setReportingLine` reaches the person as its
 * own words rather than being swallowed or replaced by the generic fallback.
 */
describe("People — a reporting line the database refuses", () => {
  beforeEach(() => vi.clearAllMocks());

  // Copied from platform/auth/members.ts. If it drifts there this test keeps
  // passing, which is why the paragraph above says what this does not cover.
  const REFUSED =
    "An Employee can't have people reporting to them, because leave is approved by whoever " +
    "somebody reports to. Give them the Manager, Supervisor or Coordinator role first.";

  async function nameRaviAsPriyasManager() {
    const user = userEvent.setup();
    await renderPeople();
    const select = within(rowFor("Priya Employee")).getByTestId("reporting-line");
    await user.selectOptions(select, RAVI);
    return user;
  }

  it("shows the refusal in its own words, not a generic apology", async () => {
    vi.mocked(setReportingLine).mockRejectedValueOnce(
      new AppError("MANAGER_CANNOT_APPROVE", REFUSED, 400),
    );

    await nameRaviAsPriyasManager();

    expect(await screen.findByTestId("members-error")).toHaveTextContent(REFUSED);
    // The fallback in the catch. If `isAppError` ever stopped recognising the
    // error — a second copy of the class, a re-wrapped throw — this is the
    // sentence that would appear instead, and it names nothing.
    expect(screen.getByTestId("members-error")).not.toHaveTextContent(
      "That reporting line couldn't be set.",
    );
  });

  it("does not leave the refusal on screen once a different line is accepted", async () => {
    // The bug shape from the leave form, on this screen: an error that outlived
    // the thing it described. "An Employee can't have people reporting to them"
    // sitting under a line that now reads Mark Manager is a false statement
    // about the current state of the row.
    vi.mocked(setReportingLine).mockRejectedValueOnce(
      new AppError("MANAGER_CANNOT_APPROVE", REFUSED, 400),
    );

    const user = await nameRaviAsPriyasManager();
    expect(await screen.findByTestId("members-error")).toBeInTheDocument();

    // Now a manager who can approve. The mock resolves this time.
    await user.selectOptions(within(rowFor("Priya Employee")).getByTestId("reporting-line"), MARK);

    await waitFor(() => expect(screen.queryByTestId("members-error")).toBeNull());
  });

  /**
   * A refused write must not leave the control describing it.
   *
   * Worth recording precisely what makes this fail, because it is not what the
   * source says it is. `onSetManager` reloads inside its catch, commented
   * "the select is showing a value the database refused, and leaving it there
   * tells the person their change stuck" — and DELETING that reload does not
   * fail this test. The `<select>` is controlled, `setError` re-renders, and
   * React restores the value from `members` on its own. The reload is
   * defensive, not load-bearing, for this particular symptom.
   *
   * What does fail it is an optimistic update with no rollback — four lines
   * somebody will one day add to make the dropdown feel quicker. That is the
   * regression this is here for; the wording above is so nobody trusts the
   * reload to be the guard.
   */
  it("puts the reporting line back to the manager that is stored", async () => {
    vi.mocked(setReportingLine).mockRejectedValueOnce(
      new AppError("MANAGER_CANNOT_APPROVE", REFUSED, 400),
    );

    await nameRaviAsPriyasManager();
    await screen.findByTestId("members-error");

    const select = within(rowFor("Priya Employee")).getByTestId(
      "reporting-line",
    ) as HTMLSelectElement;
    expect(select.value).toBe(SUNITA);
    expect(select.selectedOptions[0].textContent).toBe("Sunita Kapoor");
  });
});

/**
 * The second door to the same rule.
 *
 * Deactivating somebody moves their reports and their waiting approvals to a
 * successor DIRECTLY — it does not go through `setReportingLine` — so it is a
 * second way to end up with an Employee holding a team, and the database refuses
 * it separately as `SUCCESSOR_CANNOT_APPROVE`. Both refusals surface in the same
 * `members-error` region, and this is the flow that reaches it the long way:
 * open the confirmation, choose a successor, press the button.
 *
 * Same honest limit as above — the mapping lives in `platform/auth/members.ts`,
 * which is mocked here. What this pins is that the sentence survives the trip to
 * the screen instead of becoming "That person couldn't be deactivated."
 */
describe("People — handing a leaver's team to somebody who cannot approve", () => {
  beforeEach(() => vi.clearAllMocks());

  const REFUSED =
    "This person's reports and approvals have to go to somebody who can approve leave. " +
    "Choose a manager, supervisor, coordinator or administrator.";

  it("shows the refusal in its own words", async () => {
    // Sunita is the Supervisor with Priya underneath her, so there is genuinely
    // something to hand over — the database only raises this when there is.
    // Ravi, an Employee, is the successor that cannot be given it.
    vi.mocked(deactivationImpact).mockResolvedValue({ reports: 1, approvals: 0 });
    vi.mocked(deactivateMember).mockRejectedValueOnce(
      new AppError("MANAGER_CANNOT_APPROVE", REFUSED, 400),
    );

    const user = userEvent.setup();
    await renderPeople();

    const sunita = rowFor("Sunita Kapoor");
    await user.click(within(sunita).getByTestId("deactivate"));

    const confirm = await within(rowFor("Sunita Kapoor")).findByTestId("deactivate-confirm");
    await user.selectOptions(within(confirm).getByTestId("successor"), RAVI);
    await user.click(within(confirm).getByTestId("confirm-deactivate"));

    expect(await screen.findByTestId("members-error")).toHaveTextContent(REFUSED);
    expect(screen.getByTestId("members-error")).not.toHaveTextContent(
      "That person couldn't be deactivated.",
    );
  });
});

// @vitest-environment happy-dom

/**
 * A name is not optional any more, and the button has to agree with the label.
 *
 * The form said "Name (optional)" and its submit button was
 * `disabled={busy || !email}` — so an administrator could invite eight people by
 * address alone, and every screen that identifies somebody BY their name
 * (People, the approval timeline, the reporting-line and successor dropdowns)
 * fell back to showing a login. Nothing errored. The workspace simply read as a
 * list of email addresses.
 *
 * The database is now the backstop — `fullName` is `.min(1)` in InviteInput and
 * the migration adds the constraint — but a form that lets somebody press a
 * button and then refuses them is a worse form than one that never enables it.
 * These tests are about the button and the label, which is all a person sees.
 *
 * Each test below was watched failing against the previous code before it was
 * believed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── the seam
//
// `inviteMember` is the only thing this form reaches for, and it goes straight
// to an RPC. Replaced here so the test is about the form's own rules: given
// these keystrokes, what may a person press?
const inviteMember = vi.fn<(input: unknown) => Promise<string>>(async () => "invitation-id");
vi.mock("./members", () => ({ inviteMember: (input: unknown) => inviteMember(input) }));

/**
 * D58 — the department read.
 *
 * Left unmocked this reaches the real Supabase client, and every test in this
 * file fired two HTTP requests at whatever was listening on localhost. They came
 * back 401 and the form's `.catch(() => {})` swallowed it, so the suite passed
 * while talking to a database.
 */
const listDepartments = vi.fn<() => Promise<{ id: string; name: string }[]>>();
vi.mock("@/platform/organization", () => ({ listDepartments: () => listDepartments() }));

import { InviteTeam } from "./InviteTeam";

/** Real UUIDs: `InviteInput.departmentId` is `z.string().uuid()`. */
const OPERATIONS = { id: "b2c4e6a8-0d1f-4a3b-8c5d-2e7f9a1b3c55", name: "Operations" };
const SALES = { id: "f70a3c19-4b2d-4e6f-9a80-5c3d1e7b2f44", name: "Sales" };

/**
 * Root-level, so it runs before each describe's own `vi.clearAllMocks()` —
 * outer hooks first, and `mockClear` forgets the calls but keeps the
 * implementation.
 */
beforeEach(() => {
  listDepartments.mockReset();
  // The starting state of every new workspace, and the one the existing tests
  // in this file were written against: none configured, no Department field.
  listDepartments.mockResolvedValue([]);
});

// Deliberately loose. Only the first test is about the label's exact words; if
// it ever reads "Full name" the button tests below should still be measuring
// the button, not the wording.
const nameField = () => screen.getByRole("textbox", { name: /^name/i }) as HTMLInputElement;
const emailField = () => screen.getByLabelText("Work email") as HTMLInputElement;
const sendButton = () => screen.getByTestId("send-invite");

describe("InviteTeam — the name is required", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not call the name optional, and marks the field required", () => {
    render(<InviteTeam />);

    // `getByLabelText` matches the whole label. "Name (optional)" does not
    // equal "Name", so the old wording fails here by name rather than by a
    // vague regex over the page.
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name).toBeRequired();

    const label = document.querySelector('label[for="inv-name"]');
    expect(label).not.toBeNull();
    expect(label?.textContent ?? "").not.toMatch(/optional/i);
    // The word still belongs on this screen — Phone is genuinely optional — so
    // this is scoped to the one label rather than the whole form.
  });

  it("keeps Send invitation disabled on an email alone, and enables it once a name is typed", async () => {
    // THE REGRESSION. `disabled={busy || !email}` let this through: the button
    // came alive on the address, and the name was a field you could skip past.
    const user = userEvent.setup();
    render(<InviteTeam />);

    expect(sendButton()).toBeDisabled();

    await user.type(emailField(), "priya.patel@acme.test");
    expect(emailField()).toHaveValue("priya.patel@acme.test");
    expect(sendButton()).toBeDisabled();

    await user.type(nameField(), "Priya Patel");
    expect(sendButton()).toBeEnabled();
  });

  it("does not accept a name of spaces", async () => {
    // The other half of the guard: `!fullName` is satisfied by " ", which is
    // exactly what a stray space bar or an autofill leaves behind. The database
    // trims before it validates, so a form that accepted this would send a
    // request that came back refused.
    const user = userEvent.setup();
    render(<InviteTeam />);

    await user.type(emailField(), "priya.patel@acme.test");
    await user.type(nameField(), "   ");

    expect(nameField()).toHaveValue("   ");
    expect(sendButton()).toBeDisabled();

    // And a real name after the spaces is fine — the rule is "something other
    // than whitespace", not "no leading space".
    await user.type(nameField(), "Priya Patel");
    expect(sendButton()).toBeEnabled();
  });

  it("sends the name with the invitation, and clears the form back to disabled", async () => {
    // A required field that never reaches the RPC is a required field for
    // nothing. This also pins the reset: after a successful send both inputs
    // are empty, so the button must be disabled again rather than sitting
    // enabled over a blank form.
    const user = userEvent.setup();
    render(<InviteTeam />);

    await user.type(emailField(), "priya.patel@acme.test");
    await user.type(nameField(), "Priya Patel");
    await user.click(sendButton());

    expect(inviteMember).toHaveBeenCalledTimes(1);
    expect(inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({ email: "priya.patel@acme.test", fullName: "Priya Patel" }),
    );

    expect(await screen.findByText("priya.patel@acme.test")).toBeInTheDocument();
    expect(nameField()).toHaveValue("");
    expect(sendButton()).toBeDisabled();
  });
});

/**
 * D57 — Supervisor and Coordinator.
 *
 * This form is where a role is CHOSEN, so it is the first place a role that
 * exists in the database but not in the label map becomes visible. It used to
 * keep its own `Record<AppRole, string>`; that copy is gone and the map now
 * comes from `contracts`, real here rather than stubbed — a fake map in this
 * file would make these tests agree with themselves and with nothing else.
 *
 * The failure being pinned is not "the option is missing". A `<option>` whose
 * label is `undefined` still renders, still has the right value, and is still
 * selectable — it is simply BLANK. An administrator sees a gap in the list and
 * has no way to know what it is for.
 */
describe("InviteTeam — the Role dropdown", () => {
  beforeEach(() => vi.clearAllMocks());

  const roleSelect = () => screen.getByLabelText("Role") as HTMLSelectElement;

  it("offers all six roles, each with the word a person reads", () => {
    render(<InviteTeam />);

    const options = within(roleSelect()).getAllByRole("option") as HTMLOptionElement[];
    // Value and label together. Either half alone passes against the bug: the
    // values come from APP_ROLES and were never wrong, and a label list alone
    // would not catch a label attached to the wrong role.
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ["org_admin", "Administrator"],
      ["hr_admin", "HR administrator"],
      ["manager", "Manager"],
      ["supervisor", "Supervisor"],
      ["coordinator", "Coordinator"],
      ["employee", "Employee"],
    ]);
  });

  it("starts on Employee, and says so rather than showing a blank box", () => {
    // The default is the least privilege, which is right — but a `<select>`
    // reports its default the same way it reports a stored value, so the thing
    // to check is what is legible in the closed box, not the value behind it.
    render(<InviteTeam />);

    expect(roleSelect().value).toBe("employee");
    expect(roleSelect().selectedOptions[0].textContent).toBe("Employee");
  });

  it("sends the role's database value, not the label on screen", async () => {
    // The half that leaves the screen. `<option>Supervisor</option>` without a
    // `value` is valid HTML and reads identically; it would send the string
    // "Supervisor" to a column whose enum only knows "supervisor".
    const user = userEvent.setup();
    render(<InviteTeam />);

    await user.selectOptions(roleSelect(), "supervisor");
    expect(roleSelect().selectedOptions[0].textContent).toBe("Supervisor");

    await user.type(emailField(), "sunita.kapoor@acme.test");
    await user.type(nameField(), "Sunita Kapoor");
    await user.click(sendButton());

    expect(inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({ role: "supervisor", fullName: "Sunita Kapoor" }),
    );
  });
});

/**
 * D58 — the Department field.
 *
 * Departments have existed in the database since the first migration and
 * nothing in the product ever wrote a row, so the Department column on both
 * leave reports was blank for everybody. Placing somebody at the moment they
 * are invited is one of the two ways it gets filled in — the other is the
 * People screen, once they have accepted.
 *
 * The field is conditional, which is the part that needs both sides tested. A
 * dropdown whose only entry is "No department" is a control that asks a
 * question it cannot answer, and a field that appears at a moment nobody can
 * predict reads as broken.
 */
describe("InviteTeam — the Department field", () => {
  beforeEach(() => vi.clearAllMocks());

  const deptSelect = () => screen.getByLabelText(/^Department/) as HTMLSelectElement;

  /** Renders and waits for the department read to have landed either way. */
  async function renderInvite() {
    render(<InviteTeam />);
    await waitFor(() => expect(listDepartments).toHaveBeenCalledTimes(1));
    // The read resolves in a microtask after the call; this settles the state
    // update so an absence assertion is about the render and not about timing.
    await waitFor(() => expect(sendButton()).toBeDisabled());
  }

  it("does not offer an empty dropdown when the workspace has no departments", async () => {
    listDepartments.mockResolvedValue([]);
    const user = userEvent.setup();
    await renderInvite();

    expect(screen.queryByLabelText(/^Department/)).toBeNull();
    expect(screen.queryByText("No department")).toBeNull();

    // And the form is still fully usable — the missing field costs nothing.
    await user.type(emailField(), "priya.patel@acme.test");
    await user.type(nameField(), "Priya Patel");
    await user.click(sendButton());

    expect(inviteMember).toHaveBeenCalledTimes(1);
  });

  it("appears once departments exist, defaulting to No department", async () => {
    // The same wait as the test above, so the absence there is genuinely about
    // the condition and not about the assertion running too early.
    listDepartments.mockResolvedValue([OPERATIONS, SALES]);
    await renderInvite();

    const select = deptSelect();
    expect(select.value).toBe("");
    // What is legible in the closed box, not just the value behind it.
    expect(select.selectedOptions[0].textContent).toBe("No department");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["No department", "Operations", "Sales"]);
  });

  it("sends the chosen department with the invitation", async () => {
    listDepartments.mockResolvedValue([OPERATIONS, SALES]);
    const user = userEvent.setup();
    await renderInvite();

    // Sales is the last option, so a select falling back to its first would be
    // visible here rather than agreeing with the assertion by accident.
    await user.selectOptions(deptSelect(), SALES.id);
    expect(deptSelect().selectedOptions[0].textContent).toBe("Sales");

    await user.type(emailField(), "priya.patel@acme.test");
    await user.type(nameField(), "Priya Patel");
    await user.click(sendButton());

    expect(inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({ email: "priya.patel@acme.test", departmentId: SALES.id }),
    );
  });

  it("sends null for No department, not an empty string", async () => {
    // `InviteInput.departmentId` is `z.string().uuid().nullable()`, and "" is
    // neither. The invitation would be refused by its own schema for a choice
    // that is the default and entirely legitimate.
    listDepartments.mockResolvedValue([OPERATIONS, SALES]);
    const user = userEvent.setup();
    await renderInvite();

    await user.type(emailField(), "priya.patel@acme.test");
    await user.type(nameField(), "Priya Patel");
    await user.click(sendButton());

    expect(inviteMember).toHaveBeenCalledWith(expect.objectContaining({ departmentId: null }));
    // The specific wrong value, named, so the failure says which one it was.
    expect(inviteMember).not.toHaveBeenCalledWith(expect.objectContaining({ departmentId: "" }));
  });

  it("still lets somebody be invited when the department read fails", async () => {
    // The read is deliberately non-blocking. Inviting people is what this form
    // is FOR, and a workspace with no departments is the normal starting state
    // — so a failed read must look like that rather than like a broken form.
    listDepartments.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    await renderInvite();

    expect(screen.queryByLabelText(/^Department/)).toBeNull();
    expect(screen.queryByTestId("invite-error")).toBeNull();

    await user.type(emailField(), "priya.patel@acme.test");
    await user.type(nameField(), "Priya Patel");
    await user.click(sendButton());

    expect(inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({ email: "priya.patel@acme.test", departmentId: null }),
    );
  });
});

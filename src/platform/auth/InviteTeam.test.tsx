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
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── the seam
//
// `inviteMember` is the only thing this form reaches for, and it goes straight
// to an RPC. Replaced here so the test is about the form's own rules: given
// these keystrokes, what may a person press?
const inviteMember = vi.fn<(input: unknown) => Promise<string>>(async () => "invitation-id");
vi.mock("./members", () => ({ inviteMember: (input: unknown) => inviteMember(input) }));

import { InviteTeam } from "./InviteTeam";

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

// @vitest-environment happy-dom

/**
 * Departments, as an administrator meets them.
 *
 * The table has existed since the first migration — RLS, an admin write policy,
 * grants, a foreign key from `profiles` — and nothing in the product ever wrote
 * a row. So the Department column on both leave reports was blank for
 * everybody, and nothing anywhere said why. This screen is the write side, and
 * this file is about the four things on it that can lie quietly:
 *
 *   · an empty list that does not say what an empty list costs;
 *   · a head count that says "1 people";
 *   · a confirmation that asks you to remove something without telling you how
 *     many people it takes out of a department;
 *   · a success notice that reports the number that was on screen a moment ago
 *     rather than the number the database actually moved.
 *
 * The last one is the one worth the file. `d.memberCount` came from a read that
 * happened before the click; `peopleUnassigned` comes back from the write. They
 * are the same number almost always, and when they are not, the row is stale
 * and the notice is the only honest one of the two.
 *
 * The handler half — the Postgres refusals, the count assembled in TypeScript —
 * is in `departments.test.ts` and is deliberately not repeated through the DOM.
 *
 * Every test below was watched failing against a deliberately broken copy of
 * `Departments.tsx` before it was believed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Department, DepartmentInput } from ".";

// ── the seam
//
// Three handlers, all of them database calls. Everything below the component is
// replaced; nothing about the component is.
//
// `DepartmentInput` is left REAL — it is the Zod schema that trims the name
// before the handler ever sees it, and a stub here would leave this suite
// passing against a form that stores "  Operations  ". The Supabase client the
// real module imports is stubbed with a proxy that throws, so a render test that
// somehow reaches the database fails loudly instead of going quiet down a
// socket.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get() {
        throw new Error("a render test reached the real Supabase client");
      },
    },
  ),
}));

const listDepartments = vi.fn<() => Promise<Department[]>>();
const saveDepartment = vi.fn<(input: DepartmentInput, organizationId: string) => Promise<void>>(
  async () => {},
);
const removeDepartment = vi.fn<(id: string) => Promise<{ peopleUnassigned: number }>>(async () => ({
  peopleUnassigned: 0,
}));

vi.mock("./index", async (importOriginal) => ({
  DepartmentInput: ((await importOriginal()) as typeof import("./index")).DepartmentInput,
  listDepartments: () => listDepartments(),
  saveDepartment: (input: DepartmentInput, organizationId: string) =>
    saveDepartment(input, organizationId),
  removeDepartment: (id: string) => removeDepartment(id),
}));

import { Departments } from "./Departments";

const ORG = "org-7";

/**
 * Three departments, and the three head counts that render differently.
 *
 * Not three departments with three people each. Sales exists to be the
 * singular — "1 person", the one boundary a plural helper gets wrong — and
 * Facilities exists to be zero, which is a different sentence again rather than
 * "0 people". They arrive name-ordered because `listDepartments` orders by name.
 *
 * The ids are real UUIDs because the id is `z.string().uuid()` in
 * `DepartmentInput`, which is real in this file. A tidier `"sales-id"` fixture
 * made the rename test fail with "Invalid uuid" — the schema was right and the
 * fixture was lying about what the database hands back.
 */
const FACILITIES: Department = {
  id: "6d1f2b0a-8f7e-4c33-9f2a-1a5b0c7d9e11",
  name: "Facilities",
  parentDepartmentId: null,
  memberCount: 0,
};
const OPERATIONS: Department = {
  id: "b2c4e6a8-0d1f-4a3b-8c5d-2e7f9a1b3c55",
  name: "Operations",
  parentDepartmentId: null,
  memberCount: 3,
};
const SALES: Department = {
  id: "f70a3c19-4b2d-4e6f-9a80-5c3d1e7b2f44",
  name: "Sales",
  parentDepartmentId: null,
  memberCount: 1,
};

const ALL = [FACILITIES, OPERATIONS, SALES];

const nameField = () => screen.getByLabelText("Department name") as HTMLInputElement;
const addButton = () => screen.getByTestId("add-department");

/**
 * One department's row, found by the name printed on it.
 *
 * The input branch is not padding. While a row is being renamed its name lives
 * in an `<input>` value, and an input contributes nothing to `textContent` — so
 * a plain text match loses the row at exactly the moment the rename tests need
 * to click Save on it.
 */
function rowFor(name: string): HTMLElement {
  const rows = screen.getAllByTestId("department-row").filter((r) => {
    if ((r.textContent ?? "").includes(name)) return true;
    return [...r.querySelectorAll("input")].some(
      (i) => i.value.includes(name) || (i.getAttribute("aria-label") ?? "").includes(name),
    );
  });
  if (rows.length !== 1) {
    throw new Error(`expected exactly one department row for "${name}", found ${rows.length}`);
  }
  return rows[0];
}

/** Renders and waits for the skeleton to give way. */
async function renderSettled() {
  render(<Departments organizationId={ORG} />);
  // The add form is present in both the "some" and the "none" states, so it is
  // the settle point that does not assume which one is being tested.
  await screen.findByTestId("department-name");
}

beforeEach(() => {
  vi.clearAllMocks();
  listDepartments.mockResolvedValue(ALL);
  saveDepartment.mockResolvedValue(undefined);
  removeDepartment.mockResolvedValue({ peopleUnassigned: 0 });
});

describe("Departments — when there are none", () => {
  it("says what stays broken until one is added, rather than showing nothing", async () => {
    // A bordered box with nothing in it reads as a screen that failed. The
    // reason this list being empty MATTERS is invisible from here — it shows up
    // as a blank column on a report somebody runs next month — so the screen has
    // to say it.
    listDepartments.mockResolvedValue([]);
    await renderSettled();

    expect(screen.getByText(/No departments yet/)).toHaveTextContent(
      /the Department column on every report stays empty/,
    );
    expect(screen.queryAllByTestId("department-row")).toHaveLength(0);
    // And the way out is on screen, not somewhere else.
    expect(nameField()).toBeInTheDocument();
  });

  it("does not show the empty-state sentence once a department exists", async () => {
    // The other side of the condition. An empty state that outlives the
    // emptiness is a screen telling somebody to do a thing they have done.
    await renderSettled();
    expect(screen.queryByText(/No departments yet/)).toBeNull();
    expect(screen.getAllByTestId("department-row")).toHaveLength(3);
  });
});

describe("Departments — adding one", () => {
  it("will not let a blank or whitespace-only name be submitted", async () => {
    // `!name` is satisfied by " ", which is what a stray space bar leaves. The
    // database trims before it validates, so a form that accepted this would
    // send a request that came back refused for a reason nobody typed.
    const user = userEvent.setup();
    await renderSettled();

    expect(addButton()).toBeDisabled();

    await user.type(nameField(), "   ");
    expect(nameField()).toHaveValue("   ");
    expect(addButton()).toBeDisabled();

    await user.type(nameField(), "Marketing");
    expect(addButton()).toBeEnabled();
  });

  it("sends the trimmed name and this workspace's id, and clears the box", async () => {
    // Two promises a person cannot see. The trim is why "Sales " and "Sales" do
    // not become two departments a case-insensitive unique index then argues
    // about; the organisation id is the prop, not something the form invents.
    const user = userEvent.setup();
    await renderSettled();

    await user.type(nameField(), "  Marketing  ");
    await user.click(addButton());

    await waitFor(() => expect(saveDepartment).toHaveBeenCalledTimes(1));
    expect(saveDepartment).toHaveBeenCalledWith({ name: "Marketing" }, ORG);
    // Not the untrimmed string, stated separately so the failure names it.
    expect(saveDepartment.mock.calls[0][0].name).not.toMatch(/^\s|\s$/);

    // The box is empty again, so the button is back to disabled rather than
    // sitting enabled over a name that has already been added.
    await waitFor(() => expect(nameField()).toHaveValue(""));
    expect(addButton()).toBeDisabled();
    expect(screen.queryByTestId("departments-error")).toBeNull();
  });

  it("does not leave a refusal on screen under a name that has since been corrected", async () => {
    // The bug shape from the leave form, on this screen. A refusal belongs to
    // the value that caused it — "There's already a department with that name"
    // sitting above a box that now reads "Marketing" is a false statement about
    // what is in front of the person, and the only way to find out is to press
    // the button and see whether it works this time.
    const { AppError } = await import("@/platform/errors");
    saveDepartment.mockRejectedValueOnce(
      new AppError("VALIDATION_FAILED", "There's already a department with that name.", 400),
    );

    const user = userEvent.setup();
    await renderSettled();

    await user.type(nameField(), "Sales");
    await user.click(addButton());

    expect(await screen.findByTestId("departments-error")).toHaveTextContent(
      "There's already a department with that name.",
    );

    await user.type(nameField(), "!");
    expect(screen.queryByTestId("departments-error")).toBeNull();
  });
});

describe("Departments — the head count on each row", () => {
  it("tells nobody, one person and several people apart", async () => {
    // `getByText` with a string matches an element's WHOLE text, so "1 people"
    // does not satisfy "1 person" and the failure names the wrong plural rather
    // than pointing vaguely at the row.
    await renderSettled();

    expect(within(rowFor("Facilities")).getByText("Nobody in it yet")).toBeInTheDocument();
    expect(within(rowFor("Sales")).getByText("1 person")).toBeInTheDocument();
    expect(within(rowFor("Operations")).getByText("3 people")).toBeInTheDocument();

    // Zero is its own sentence, not the plural branch with a 0 in it.
    expect(within(rowFor("Facilities")).queryByText(/0 (person|people)/)).toBeNull();
  });
});

describe("Departments — removing one", () => {
  it("asks first, and the question states how many people it empties", async () => {
    // The number of people affected IS the decision. Removing "Operations"
    // takes three people out of a department, and they find out from a report
    // with a blank column.
    const user = userEvent.setup();
    await renderSettled();

    expect(screen.queryByTestId("remove-confirm")).toBeNull();

    await user.click(within(rowFor("Operations")).getByTestId("remove-department"));

    const confirm = within(rowFor("Operations")).getByTestId("remove-confirm");
    expect(confirm).toHaveTextContent("3 people will no longer be in a department");
    // Nothing was removed by asking.
    expect(removeDepartment).not.toHaveBeenCalled();
  });

  it("says nothing else changes when the department is empty", async () => {
    // The other side of the same sentence. "0 people will no longer be in a
    // department" is technically true and reads as a warning about nothing.
    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(rowFor("Facilities")).getByTestId("remove-department"));

    const confirm = within(rowFor("Facilities")).getByTestId("remove-confirm");
    expect(confirm).toHaveTextContent("Nobody is in it, so nothing else changes");
    expect(confirm).not.toHaveTextContent(/will no longer be in a department/);
  });

  it("reports the number the database moved, not the number that was on the row", async () => {
    // THE ONE WORTH THE FILE. `memberCount` came from a read that happened
    // before the click; `peopleUnassigned` comes back from the write. Two people
    // joined Operations in another tab while this screen sat open, so the row
    // says 3 and the truth is 5 — and the notice is the only one of the two that
    // was ever asked.
    removeDepartment.mockResolvedValue({ peopleUnassigned: 5 });

    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(rowFor("Operations")).getByTestId("remove-department"));
    // The list the screen reloads with no longer has Operations in it, which is
    // also what makes the notice the only surviving statement about it.
    listDepartments.mockResolvedValue([FACILITIES, SALES]);
    await user.click(within(rowFor("Operations")).getByTestId("confirm-remove-department"));

    expect(removeDepartment).toHaveBeenCalledWith(OPERATIONS.id);

    const notice = await screen.findByTestId("departments-notice");
    expect(notice).toHaveTextContent("5 people are no longer in a department");
    // The stale figure, named. A notice reading "3" here is a false statement
    // about two people's records that nothing else on the screen would correct.
    expect(notice).not.toHaveTextContent(/\b3\b/);

    // The confirmation closes and the row is gone.
    await waitFor(() => expect(screen.queryByTestId("remove-confirm")).toBeNull());
    expect(screen.queryByText("Operations")).toBeNull();
  });

  it("says nobody was in it rather than '0 people' when nothing moved", async () => {
    removeDepartment.mockResolvedValue({ peopleUnassigned: 0 });

    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(rowFor("Facilities")).getByTestId("remove-department"));
    listDepartments.mockResolvedValue([OPERATIONS, SALES]);
    await user.click(within(rowFor("Facilities")).getByTestId("confirm-remove-department"));

    const notice = await screen.findByTestId("departments-notice");
    expect(notice).toHaveTextContent("“Facilities” removed. Nobody was in it.");
    expect(notice).not.toHaveTextContent(/0 (person|people)/);
  });
});

describe("Departments — renaming one", () => {
  it("swaps the row for an input holding the current name, and back again", async () => {
    // The control-misreports-state case, in its smallest form. An edit box that
    // opens empty invites somebody to retype a name they cannot see, and an edit
    // box that opens with the WRONG name renames the wrong thing.
    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(rowFor("Sales")).getByRole("button", { name: "Rename" }));

    const box = within(rowFor("Sales")).getByLabelText("Rename Sales") as HTMLInputElement;
    expect(box.value).toBe("Sales");
    // The row's own controls are gone while it is being edited — two Rename
    // buttons over one department is how you rename the other one.
    expect(within(rowFor("Sales")).queryByTestId("remove-department")).toBeNull();
    // And only this row swapped.
    expect(within(rowFor("Operations")).getByTestId("remove-department")).toBeInTheDocument();

    await user.click(within(rowFor("Sales")).getByRole("button", { name: "Cancel" }));

    expect(within(rowFor("Sales")).queryByLabelText("Rename Sales")).toBeNull();
    expect(within(rowFor("Sales")).getByTestId("remove-department")).toBeInTheDocument();
  });

  it("saves the new name against the same department, and puts the row back", async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(rowFor("Sales")).getByRole("button", { name: "Rename" }));
    const box = within(rowFor("Sales")).getByLabelText("Rename Sales");
    await user.clear(box);
    await user.type(box, "Revenue");

    // What the reload will return, so the row genuinely comes back with the new
    // name rather than the test asserting against its own optimism.
    listDepartments.mockResolvedValue([FACILITIES, OPERATIONS, { ...SALES, name: "Revenue" }]);
    await user.click(within(rowFor("Sales")).getByTestId("save-department"));

    // The id is what makes this a rename rather than a fourth department.
    await waitFor(() => expect(saveDepartment).toHaveBeenCalledTimes(1));
    expect(saveDepartment).toHaveBeenCalledWith({ id: SALES.id, name: "Revenue" }, ORG);

    const revenue = await waitFor(() => rowFor("Revenue"));
    expect(within(revenue).queryByRole("textbox")).toBeNull();
    expect(within(revenue).getByRole("button", { name: "Rename" })).toBeInTheDocument();
    // The head count survived the swap back.
    expect(within(revenue).getByText("1 person")).toBeInTheDocument();
  });
});

describe("Departments — when the list cannot be read", () => {
  it("says so, rather than showing the 'none configured' empty state", async () => {
    // Two different nothings. An empty list means "this workspace has not set
    // any up" and is a legitimate state with an instruction attached; a failed
    // read means "we do not know". Rendering the first for the second tells an
    // administrator to add departments they may already have.
    listDepartments.mockRejectedValue(new Error("network"));
    render(<Departments organizationId={ORG} />);

    expect(await screen.findByText(/couldn't load your departments/i)).toBeInTheDocument();
    expect(screen.queryByText(/No departments yet/)).toBeNull();
    expect(screen.queryAllByTestId("department-row")).toHaveLength(0);
  });
});

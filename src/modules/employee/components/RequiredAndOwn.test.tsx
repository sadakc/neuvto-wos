// @vitest-environment happy-dom

/**
 * D107, against real employee_card() output. What it pins:
 *
 * - the person's own card offers Edit on exactly the panels holding a field
 *   their company lets them update, and each form holds only those fields;
 * - a relative their company keeps is shown, sent back as it is, and cannot be
 *   edited or removed; only relations they may add are offered;
 * - an address of a type they may not add is not offered, nor "also permanent";
 * - a required field stops a save while empty, even untouched, and the form
 *   says which fields are required; at a company that does not require it,
 *   the same form saves;
 * - a nominee's date of birth, once required, stops the nomination; a
 *   required number not on record stops the statutory form;
 * - the database's refusals read as what they mean.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { employeeErrorMessage, type EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(async () => []),
  listDocumentViews: vi.fn(async () => []),
  getThisYear: vi.fn(),
  listCardViews: vi.fn(async () => []),
  addAddress: vi.fn(),
  attachAddressProof: vi.fn(),
  listActiveUnits: vi.fn(),
  listDesignations: vi.fn(),
  saveFamily: vi.fn(),
  saveNomination: vi.fn(),
  savePreviousOrgs: vi.fn(),
  updateEmployee: vi.fn(),
  getRestrictedReads: vi.fn(),
  listChangeRequests: vi.fn(),
  requestChange: vi.fn(),
  setStatutory: vi.fn(),
  revealRestricted: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const self = as("self");
const admin = as("admin");
/** The same card at a company that answered differently for one field. */
const without = (card: EmployeeCard, list: "ownFields" | "requiredFields", ...keys: string[]) => ({
  ...card,
  capabilities: {
    ...card.capabilities,
    [list]: (card.capabilities[list] ?? []).filter((k) => !keys.includes(k)),
  },
});
const withAlso = (card: EmployeeCard, list: "ownFields" | "requiredFields", ...keys: string[]) => ({
  ...card,
  capabilities: { ...card.capabilities, [list]: [...(card.capabilities[list] ?? []), ...keys] },
});

beforeEach(() => {
  vi.resetAllMocks();
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.listDesignations.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
  api.listChangeRequests.mockResolvedValue([]);
  api.updateEmployee.mockResolvedValue(undefined);
  api.saveFamily.mockResolvedValue(undefined);
  api.saveNomination.mockResolvedValue("n1");
  api.addAddress.mockResolvedValue([{ id: "a1", addressType: "present" }]);
});

const user = () => userEvent.setup();
async function openTab(name: string) {
  await user().click(screen.getByRole("tab", { name }));
}

/** Every Edit and Add the open tab offers, by test id. */
const offered = () =>
  [...document.querySelectorAll("[data-testid^='edit-'], [data-testid='add-address']")]
    .map((b) => b.getAttribute("data-testid"))
    .sort();

describe("the person's own card", () => {
  it("offers Edit on exactly the panels that hold a field of theirs", async () => {
    render(<EmployeeCardView card={self} />);
    expect(offered()).toEqual(["edit-contact", "edit-emergency"]);
    await openTab("Personal");
    // Native state and blood group are theirs; nothing in Education is.
    expect(offered()).toEqual(["edit-identity", "edit-physical"]);
    await openTab("Family");
    expect(offered()).toEqual(["edit-family", "edit-nominees"]);
    await openTab("Employment");
    expect(offered()).toEqual([]);
    await openTab("History");
    expect(offered()).toEqual(["add-address"]);
  });

  it("puts only their own fields in a form, and saves what they change", async () => {
    const u = user();
    render(<EmployeeCardView card={self} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    const editor = screen.getByTestId("editor-identity");
    expect(within(editor).getByRole("combobox", { name: "Native state" })).toBeTruthy();
    expect(within(editor).queryByLabelText("Sex")).toBeNull();
    expect(within(editor).queryByLabelText("Date of birth")).toBeNull();
    expect(within(editor).queryByLabelText("Full name")).toBeNull();
    await u.selectOptions(within(editor).getByRole("combobox", { name: "Native state" }), "Goa");
    await u.click(screen.getByTestId("save-identity"));
    expect(api.updateEmployee).toHaveBeenCalledWith(self.id, { nativeState: "Goa" });
  });

  it("offers a field once their company switches it on", async () => {
    const u = user();
    render(<EmployeeCardView card={withAlso(self, "ownFields", "sex")} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    expect(within(screen.getByTestId("editor-identity")).getByLabelText("Sex")).toBeTruthy();
  });

  it("offers no Edit on a panel once nothing in it is theirs", async () => {
    render(
      <EmployeeCardView card={without(self, "ownFields", "bloodGroup", "nearestPoliceStation")} />,
    );
    await openTab("Personal");
    expect(offered()).toEqual(["edit-identity"]);
  });
});

describe("relatives the company keeps", () => {
  const keepsSons = without(self, "ownFields", "sons");

  it("are shown, cannot be changed or removed, and are sent back as they are", async () => {
    const u = user();
    render(<EmployeeCardView card={keepsSons} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-family"));
    const editor = screen.getByTestId("family-editor");
    const kept = within(editor).getAllByTestId("family-row-locked");
    expect(kept).toHaveLength(2); // Aarav and Kabir
    for (const row of kept) {
      expect(within(row).getByRole("textbox")).toBeDisabled();
      expect(within(row).queryByRole("button", { name: /Remove/ })).toBeNull();
    }
    // Their daughter is theirs to change.
    const mine = within(editor).getByTestId("family-editor-row");
    await u.clear(within(mine).getByRole("textbox", { name: /Name/ }));
    await u.type(within(mine).getByRole("textbox", { name: /Name/ }), "Diya K");
    await u.click(screen.getByTestId("family-save"));
    const sent = api.saveFamily.mock.calls[0][1] as {
      id?: string;
      name: string;
      relation: string;
    }[];
    expect(sent.map((r) => [r.relation, r.name])).toEqual(
      (self.familyMembers ?? []).map((f) => [
        f.relation,
        f.relation === "daughter" ? "Diya K" : f.name,
      ]),
    );
  });

  it("are only those of the relation kept: sons stay theirs when daughters are kept", async () => {
    const u = user();
    render(<EmployeeCardView card={without(self, "ownFields", "daughters")} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-family"));
    const editor = screen.getByTestId("family-editor");
    expect(within(editor).getAllByTestId("family-row-locked")).toHaveLength(1); // Diya
    expect(within(editor).getAllByTestId("family-editor-row")).toHaveLength(2); // Aarav, Kabir
  });

  it("are not offered as a relation to add", async () => {
    const u = user();
    render(<EmployeeCardView card={keepsSons} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-family"));
    await u.click(screen.getByTestId("family-add-row"));
    const added = within(screen.getByTestId("family-editor"))
      .getAllByTestId("family-editor-row")
      .at(-1)!;
    const relation = within(added).getByRole("combobox");
    const choices = [...(relation as HTMLSelectElement).options].map((o) => o.value);
    expect(choices).toContain("daughter");
    expect(choices).not.toContain("son");
  });
});

describe("addresses", () => {
  it("offers only the types the person may add", async () => {
    const u = user();
    render(<EmployeeCardView card={without(self, "ownFields", "permanentAddress")} />);
    await openTab("History");
    await u.click(screen.getByTestId("add-address"));
    const type = screen.getByTestId("address-type") as HTMLSelectElement;
    expect([...type.options].map((o) => o.value)).toEqual(["present"]);
    expect(screen.queryByText("This is also the permanent address")).toBeNull();
  });

  it("offers the Employee Admin every type", async () => {
    const u = user();
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    await u.click(screen.getByTestId("add-address"));
    const type = screen.getByTestId("address-type") as HTMLSelectElement;
    expect([...type.options].map((o) => o.value)).toEqual([
      "present",
      "permanent",
      "while_deployed",
      "emergency",
    ]);
  });
});

describe("a required field", () => {
  const noDob = { ...admin, dateOfBirth: null };

  it("stops the save while empty, though untouched, and the form says it is required", async () => {
    const u = user();
    render(<EmployeeCardView card={noDob} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    expect(screen.getByTestId("required-identity").textContent).toMatch(/Date of birth/);
    await u.selectOptions(screen.getByRole("combobox", { name: "Native state" }), "Goa");
    await u.click(screen.getByTestId("save-identity"));
    expect(screen.getByText("Date of birth can't be empty.")).toBeTruthy();
    expect(api.updateEmployee).not.toHaveBeenCalled();
  });

  it("does not stop the save at a company that does not require it", async () => {
    const u = user();
    render(<EmployeeCardView card={without(noDob, "requiredFields", "dateOfBirth")} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    expect(screen.getByTestId("required-identity").textContent).not.toMatch(/Date of birth/);
    await u.selectOptions(screen.getByRole("combobox", { name: "Native state" }), "Goa");
    await u.click(screen.getByTestId("save-identity"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { nativeState: "Goa" });
  });

  it("holds the person to it too", async () => {
    const u = user();
    render(<EmployeeCardView card={self} />);
    await u.click(screen.getByTestId("edit-contact"));
    // Their mobile is required and not on record.
    await u.type(screen.getByRole("textbox", { name: "Alternate mobile" }), "9845011122");
    await u.click(screen.getByTestId("save-contact"));
    expect(screen.getByText("Mobile can't be empty.")).toBeTruthy();
    expect(api.updateEmployee).not.toHaveBeenCalled();
  });

  it("asks for every nominee's date of birth once required", async () => {
    const u = user();
    render(<EmployeeCardView card={withAlso(admin, "requiredFields", "nomineeDob")} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-nominees"));
    const dialog = screen.getByRole("dialog");
    for (const box of within(dialog).queryAllByRole("button", { name: /^Clear Date of birth/ })) {
      await u.click(box);
    }
    await u.click(within(dialog).getByRole("button", { name: /Save/ }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/every nominee's date of birth/);
    expect(api.saveNomination).not.toHaveBeenCalled();
  });
});

describe("a required number", () => {
  const noUan = (card: EmployeeCard) => ({
    ...card,
    statutory: { ...card.statutory!, uanLast4: null, uan: null },
  });

  it("stops the PF form while it is not on record", async () => {
    const u = user();
    render(<EmployeeCardView card={noUan(admin)} />);
    await openTab("Statutory and bank");
    await u.click(screen.getByTestId("edit-pf"));
    expect(screen.getByTestId("required-pf").textContent).toMatch(/UAN/);
    await u.click(screen.getByTestId("save-pf"));
    expect(screen.getByText("UAN can't be empty.")).toBeTruthy();
    expect(api.setStatutory).not.toHaveBeenCalled();
  });

  it("does not, at a company that does not require it", async () => {
    const u = user();
    render(<EmployeeCardView card={without(noUan(admin), "requiredFields", "uan")} />);
    await openTab("Statutory and bank");
    await u.click(screen.getByTestId("edit-pf"));
    await u.click(screen.getByTestId("save-pf"));
    expect(screen.queryByText("UAN can't be empty.")).toBeNull();
  });
});

describe("the database's refusals", () => {
  it("read as what they mean", () => {
    expect(employeeErrorMessage("FIELD_REQUIRED", "Date of birth")).toBe(
      "Date of birth is required. Fill it in before saving.",
    );
    expect(employeeErrorMessage("NOT_YOURS_TO_CHANGE", "Sex")).toBe(
      "Your company doesn't let you change sex yourself. Ask with Request a change.",
    );
    expect(employeeErrorMessage("SUPER_ADMIN_ONLY")).toMatch(/Only a Super Admin/);
    expect(employeeErrorMessage("FIELD_LOCKED", "Age")).toMatch(/^Age is fixed/);
  });
});

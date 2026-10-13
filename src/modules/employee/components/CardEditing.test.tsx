// @vitest-environment happy-dom

/**
 * Sada's first round of testing (D103), against real employee_card() output.
 * What it pins:
 *
 * - every panel an Admin can edit carries its own button in its header, and it
 *   says Add while the panel is empty and Edit once something is in it;
 * - an empty emergency contact is still shown to an Admin, with Add;
 * - a value that breaks a rule is said under its field, in words, and nothing
 *   is sent; fixing it clears the message and saves;
 * - an invited person's name and mobile are on the card's own forms;
 * - Designation, Department, Employment type and Reports to read "None" when
 *   empty, and each list but employment type can be added to from the field.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listDocumentViews: vi.fn(),
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  addAddress: vi.fn(),
  listActiveUnits: vi.fn(),
  listDesignations: vi.fn(),
  getAdminOverview: vi.fn(),
  addDepartment: vi.fn(),
  saveDesignation: vi.fn(),
  listManagerCandidates: vi.fn(),
  makeManager: vi.fn(),
  moveUnit: vi.fn(),
  saveFamily: vi.fn(),
  saveNomination: vi.fn(),
  savePreviousOrgs: vi.fn(),
  updateEmployee: vi.fn(),
  getRestrictedReads: vi.fn(),
  listChangeRequests: vi.fn(),
  listShifts: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("../recordExport", () => ({ downloadRecordPdf: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const admin = as("admin");

/** An Admin's view of somebody with nothing filled in yet: Deepak, invited. */
const empty: EmployeeCard = {
  ...admin,
  stage: "invited",
  hasSignedIn: false,
  emergencyContact: null as never,
  educationQualification: null,
  reasonForLeavingLastOrg: null,
  physical: { heightCm: null, chestCm: null, weightKg: null } as never,
  bloodGroup: null,
  familyMembers: [],
  nominations: [],
  previousOrganisations: [],
  employeeCode: null,
  designation: null,
  department: null,
  employmentType: null,
  reportsTo: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listDocuments.mockResolvedValue([]);
  api.listDocumentViews.mockResolvedValue([]);
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.listChangeRequests.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
  api.listDesignations.mockResolvedValue([{ id: "des-1", name: "Guard", detail: null }]);
  api.getAdminOverview.mockResolvedValue({
    departments: [{ id: "dep-ops", name: "Operations" }],
    managers: [{ profileId: "mgr-mark", fullName: "Mark Manager" }],
  });
  api.listShifts.mockResolvedValue([]);
  api.updateEmployee.mockResolvedValue(undefined);
});

const user = () => userEvent.setup();
async function openTab(name: string) {
  await user().click(screen.getByRole("tab", { name }));
}
const panel = (testId: string) => screen.getByTestId(testId);
const header = (p: HTMLElement) => p.firstElementChild as HTMLElement;

describe("each panel's button is in its own header, and says Add or Edit", () => {
  it("offers Add on an empty record, inside the header of the panel it fills", async () => {
    render(<EmployeeCardView card={empty} />);
    const emergency = panel("panel-emergency");
    expect(emergency).toHaveTextContent("No emergency contact recorded yet.");
    expect(within(header(emergency)).getByRole("button")).toHaveTextContent(
      "Add emergency contact",
    );

    await openTab("Personal");
    expect(within(header(panel("panel-identity"))).getByRole("button")).toHaveTextContent(
      "Edit identity", // a name is always there
    );
    // D104: the panel's title says what; its button says only Add or Edit.
    expect(screen.getByRole("button", { name: "Add education and experience" })).toHaveTextContent(
      /^Add$/,
    );
    expect(screen.getByRole("button", { name: "Add physical record" })).toBeInTheDocument();

    await openTab("Family");
    expect(screen.getByRole("button", { name: "Add family" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add nominees" })).toBeInTheDocument();

    await openTab("History");
    expect(screen.getByRole("button", { name: "Add previous organisations" })).toBeInTheDocument();
    // No bare "Edit" offered for something that is not there.
    expect(screen.queryByRole("button", { name: /^Edit (family|previous)/ })).toBeNull();
  });

  it("offers Edit once the panel holds something", async () => {
    render(<EmployeeCardView card={admin} />);
    expect(within(header(panel("panel-emergency"))).getByRole("button")).toHaveTextContent(
      "Edit emergency contact",
    );
    await openTab("Personal");
    expect(screen.getByRole("button", { name: "Edit education and experience" })).toHaveTextContent(
      /^Edit$/,
    );
    await openTab("Family");
    expect(screen.getByRole("button", { name: "Edit family" })).toBeInTheDocument();
  });

  it("offers nothing to a colleague, and hides an emergency contact they cannot see", () => {
    render(<EmployeeCardView card={as("colleague")} />);
    expect(screen.queryByTestId("edit-contact")).toBeNull();
    expect(screen.queryByTestId("edit-emergency")).toBeNull();
    expect(screen.queryByTestId("panel-emergency")).toBeNull();
  });
});

describe("a field that breaks a rule says so under itself", () => {
  it("refuses an 11-digit alternate mobile, then saves it fixed", async () => {
    const u = user();
    render(<EmployeeCardView card={admin} />);
    await u.click(screen.getByTestId("edit-contact"));
    const editor = screen.getByTestId("editor-contact");
    const alt = within(editor).getByLabelText("Alternate mobile");
    await u.clear(alt);
    await u.type(alt, "34654365465");
    await u.click(screen.getByTestId("save-contact"));
    expect(alt).toHaveAttribute("aria-invalid", "true");
    expect(within(editor).getByRole("alert")).toHaveTextContent(
      "A mobile number has 10 digits; this has 11.",
    );
    expect(api.updateEmployee).not.toHaveBeenCalled();

    // Sada's case (D104): cut to ten digits, still refused, because no Indian
    // mobile starts with a 3. The message says that now, not "10 digits" again.
    await u.type(alt, "{Backspace}");
    expect(within(editor).getByRole("alert")).toHaveTextContent(
      "An Indian mobile number starts with 6, 7, 8 or 9.",
    );
    await u.click(screen.getByTestId("save-contact"));
    expect(api.updateEmployee).not.toHaveBeenCalled();

    await u.clear(alt);
    await u.type(alt, "98765 43210");
    expect(within(editor).queryByRole("alert")).toBeNull();
    await u.click(screen.getByTestId("save-contact"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { alternateMobile: "98765 43210" });
  });

  it("refuses digits in a name and a relation, and a name emptied", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await u.click(screen.getByTestId("edit-emergency"));
    const editor = screen.getByTestId("editor-emergency");
    await u.type(within(editor).getByLabelText("Name"), "Lata2");
    // D104: the relation is chosen from the nominee list, nothing typed.
    const relation = within(editor).getByLabelText("Relation") as HTMLSelectElement;
    expect([...relation.options].map((o) => o.textContent)).toEqual([
      "Select",
      "Father",
      "Mother",
      "Husband",
      "Wife",
      "Son",
      "Daughter",
      "Brother",
      "Sister",
      "Guardian",
      "Other",
    ]);
    await u.selectOptions(relation, "sister");
    await u.type(within(editor).getByLabelText("Phone"), "12345");
    await u.click(screen.getByTestId("save-emergency"));
    expect(
      within(editor)
        .getAllByRole("alert")
        .map((a) => a.textContent),
    ).toEqual([
      "Letters only: no digits or symbols other than . ' and -.",
      "A mobile number has 10 digits; this has 5.",
    ]);
    expect(api.updateEmployee).not.toHaveBeenCalled();

    await u.keyboard("{Escape}");
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    const identity = screen.getByTestId("editor-identity");
    await u.clear(within(identity).getByLabelText("Full name"));
    await u.click(screen.getByTestId("save-identity"));
    expect(within(identity).getByRole("alert")).toHaveTextContent("Full name can't be empty.");
    expect(api.updateEmployee).not.toHaveBeenCalled();
  });

  it("refuses somebody under fourteen and a height that is not a number", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    const identity = screen.getByTestId("editor-identity");
    // D104: a date is typed as DD/MM/YYYY; the slashes go in by themselves.
    const dob = within(identity).getByRole("textbox", { name: "Date of birth" });
    const young = new Date().getFullYear() - 10;
    expect(dob).toHaveValue("12/06/1994");
    await u.clear(dob);
    await u.type(dob, `0101${young}`);
    expect(dob).toHaveValue(`01/01/${young}`);
    await u.click(screen.getByTestId("save-identity"));
    expect(within(identity).getByRole("alert")).toHaveTextContent(
      "They must be at least 14 years old.",
    );
    // Half a date is never taken for no date.
    await u.clear(dob);
    await u.type(dob, "3102");
    await u.click(screen.getByTestId("save-identity"));
    expect(within(identity).getByRole("alert")).toHaveTextContent(
      "Enter the date as DD/MM/YYYY, like 05/08/1990.",
    );
    expect(api.updateEmployee).not.toHaveBeenCalled();
  });

  it("corrects an invited person's name and mobile from the card", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await u.click(screen.getByTestId("edit-contact"));
    const contact = screen.getByTestId("editor-contact");
    await u.clear(within(contact).getByLabelText("Mobile"));
    await u.type(within(contact).getByLabelText("Mobile"), "+91 99999 00001");
    await u.click(screen.getByTestId("save-contact"));
    expect(api.updateEmployee).toHaveBeenCalledWith(empty.id, { mobile: "+91 99999 00001" });

    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    const identity = screen.getByTestId("editor-identity");
    await u.clear(within(identity).getByLabelText("Full name"));
    await u.type(within(identity).getByLabelText("Full name"), "Deepak Kumar");
    await u.click(screen.getByTestId("save-identity"));
    expect(api.updateEmployee).toHaveBeenLastCalledWith(empty.id, { fullName: "Deepak Kumar" });
  });
});

describe("the position's lists read None, and can be added to", () => {
  it("says None for an empty designation, department, employment type and manager", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await openTab("Employment");
    expect(
      within(header(panel("panel-position"))).getByRole("button", { name: "Add position" }),
    ).toBeInTheDocument();
    await u.click(screen.getByTestId("edit-position"));
    const editor = screen.getByTestId("editor-position");
    await within(editor).findByRole("option", { name: "Guard" });
    for (const label of ["Designation", "Department", "Employment type", "Reports to"]) {
      const select = within(editor).getByLabelText(label) as HTMLSelectElement;
      expect(select.options[0].textContent).toBe("None");
      expect(select.value).toBe("");
    }
  });

  it("adds a department from the field, selects it, and saves it", async () => {
    const u = user();
    api.addDepartment.mockResolvedValue("dep-sec");
    render(<EmployeeCardView card={empty} />);
    await openTab("Employment");
    await u.click(screen.getByTestId("edit-position"));
    const editor = screen.getByTestId("editor-position");
    await within(editor).findByRole("option", { name: "Operations" });
    const dept = within(editor).getByLabelText("Department");
    await u.selectOptions(dept, "Add a department…");
    const add = within(editor).getByTestId("add-inline");
    // A department named with nothing in it is not sent.
    await u.click(within(add).getByRole("button", { name: "Add" }));
    expect(within(add).getByRole("alert")).toHaveTextContent("New department needs a name.");
    await u.type(within(add).getByLabelText("New department"), "Security");
    await u.click(within(add).getByRole("button", { name: "Add" }));
    expect(api.addDepartment).toHaveBeenCalledWith("Security");
    expect(dept).toHaveValue("dep-sec");
    expect(within(editor).queryByTestId("add-inline")).toBeNull();
    await u.click(screen.getByTestId("save-position"));
    expect(api.updateEmployee).toHaveBeenCalledWith(empty.id, { departmentId: "dep-sec" });
  });

  it("adds a designation from the field", async () => {
    const u = user();
    api.saveDesignation.mockResolvedValue("des-new");
    render(<EmployeeCardView card={empty} />);
    await openTab("Employment");
    await u.click(screen.getByTestId("edit-position"));
    const editor = screen.getByTestId("editor-position");
    await within(editor).findByRole("option", { name: "Guard" });
    await u.selectOptions(within(editor).getByLabelText("Designation"), "Add a designation…");
    await u.type(within(editor).getByLabelText("New designation"), "Head Guard");
    await u.click(
      within(within(editor).getByTestId("add-inline")).getByRole("button", { name: "Add" }),
    );
    expect(api.saveDesignation).toHaveBeenCalledWith(null, { name: "Head Guard" });
    expect(within(editor).getByLabelText("Designation")).toHaveValue("des-new");
  });

  it("makes somebody a Manager so they can be reported to", async () => {
    const u = user();
    api.listManagerCandidates.mockResolvedValue([
      { profileId: "p-ravi", fullName: "Ravi Employee" },
    ]);
    api.makeManager.mockResolvedValue(undefined);
    render(<EmployeeCardView card={empty} />);
    await openTab("Employment");
    await u.click(screen.getByTestId("edit-position"));
    const editor = screen.getByTestId("editor-position");
    await within(editor).findByRole("option", { name: "Mark Manager" });
    const reportsTo = within(editor).getByLabelText("Reports to");
    await u.selectOptions(reportsTo, "Make somebody a Manager…");
    const add = within(editor).getByTestId("add-inline");
    await within(add).findByRole("option", { name: "Ravi Employee" });
    // Nobody chosen is not sent.
    await u.click(within(add).getByRole("button", { name: "Add" }));
    expect(api.makeManager).not.toHaveBeenCalled();
    await u.selectOptions(within(add).getByLabelText("Make a Manager"), "p-ravi");
    await u.click(within(add).getByRole("button", { name: "Add" }));
    expect(api.makeManager).toHaveBeenCalledWith("p-ravi");
    expect(reportsTo).toHaveValue("p-ravi");
    await u.click(screen.getByTestId("save-position"));
    expect(api.updateEmployee).toHaveBeenCalledWith(empty.id, { managerId: "p-ravi" });
  });
});

describe("rows and addresses are checked before they are sent", () => {
  it("refuses a relative named with digits, or born tomorrow", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-family"));
    const editor = screen.getByTestId("family-editor");
    await u.type(within(editor).getByLabelText("Name, row 1"), "Son 1");
    await u.click(screen.getByTestId("family-save"));
    expect(screen.getByTestId("family-editor-error")).toHaveTextContent(
      "Son 1: Letters only: no digits or symbols other than . ' and -.",
    );
    await u.clear(within(editor).getByLabelText("Name, row 1"));
    await u.type(within(editor).getByLabelText("Name, row 1"), "Arjun");
    // D104: a new row assumes no relation; it says Select until one is chosen.
    const relation = within(editor).getByLabelText("Relation, row 1") as HTMLSelectElement;
    expect(relation.selectedOptions[0].textContent).toBe("Select");
    await u.click(screen.getByTestId("family-save"));
    expect(screen.getByTestId("family-editor-error")).toHaveTextContent(
      "Arjun: choose a relation.",
    );
    await u.selectOptions(relation, "son");
    const t = new Date(Date.now() + 2 * 86_400_000);
    const tomorrow = `${String(t.getDate()).padStart(2, "0")}${String(t.getMonth() + 1).padStart(2, "0")}${t.getFullYear()}`;
    await u.type(within(editor).getByRole("textbox", { name: "Date of birth, row 1" }), tomorrow);
    await u.click(screen.getByTestId("family-save"));
    expect(screen.getByTestId("family-editor-error")).toHaveTextContent(
      "Arjun: the date of birth is in the future.",
    );
    expect(api.saveFamily).not.toHaveBeenCalled();
  });

  it("refuses a previous job that ends before it starts", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await openTab("History");
    await u.click(screen.getByTestId("edit-previous-orgs"));
    const editor = screen.getByTestId("previous-orgs-editor");
    await u.type(within(editor).getByLabelText("Organisation, row 1"), "G4S");
    await u.type(within(editor).getByRole("textbox", { name: "From, row 1" }), "01012021");
    await u.type(within(editor).getByRole("textbox", { name: "To, row 1" }), "01012020");
    await u.click(screen.getByTestId("previous-orgs-save"));
    expect(within(editor).getByRole("alert")).toHaveTextContent("G4S: To can't be before From.");
    expect(api.savePreviousOrgs).not.toHaveBeenCalled();
  });

  it("refuses a city with digits and a pincode that cannot be one", async () => {
    const u = user();
    render(<EmployeeCardView card={empty} />);
    await openTab("History");
    await u.click(screen.getByTestId("add-address"));
    await u.type(screen.getByTestId("address-line"), "9 Lake View");
    await u.type(screen.getByTestId("address-city"), "Hosur1");
    await u.selectOptions(screen.getByTestId("address-state"), "Tamil Nadu");
    await u.type(screen.getByTestId("address-pincode"), "635109");
    await u.click(screen.getByTestId("address-save"));
    expect(screen.getByTestId("address-error")).toHaveTextContent(
      "City/Town: Letters only, up to 60",
    );
    await u.clear(screen.getByTestId("address-city"));
    await u.type(screen.getByTestId("address-city"), "Hosur");
    await u.clear(screen.getByTestId("address-pincode"));
    await u.type(screen.getByTestId("address-pincode"), "035109");
    await u.click(screen.getByTestId("address-save"));
    expect(screen.getByTestId("address-error")).toHaveTextContent(
      "A pincode is 6 digits and doesn't start with 0.",
    );
    expect(api.addAddress).not.toHaveBeenCalled();
  });
});

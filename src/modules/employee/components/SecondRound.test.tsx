// @vitest-environment happy-dom

/**
 * Sada's second round of testing (D104), against real employee_card() output.
 * What it pins:
 *
 * - nationality is a dropdown that starts on Indian, with Nepali and
 *   Bangladeshi after it, and an empty record saves Indian if it is kept;
 * - experience before joining is two dropdowns, years and months, saved as
 *   months, with the total shown in the same form;
 * - height, chest and weight are dropdowns, and a value outside their range
 *   is still shown rather than replaced;
 * - the grade is in the Position form, and follows the designation chosen;
 * - Deploy says what it still needs, and a unit is added from the dialog;
 * - the bank panel takes a photo of the passbook or a cancelled cheque;
 * - the Personal tab carries a note about restricted data, not a panel.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listDocumentViews: vi.fn(),
  openDocument: vi.fn(),
  uploadDocument: vi.fn(),
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  listActiveUnits: vi.fn(),
  listDesignations: vi.fn(),
  getAdminOverview: vi.fn(),
  saveUnit: vi.fn(),
  moveUnit: vi.fn(),
  updateEmployee: vi.fn(),
  getRestrictedReads: vi.fn(),
  revealRestricted: vi.fn(),
  listChangeRequests: vi.fn(),
  listShifts: vi.fn(),
  setStatutory: vi.fn(),
  setBank: vi.fn(),
  setRestricted: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("../recordExport", () => ({ downloadRecordPdf: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";
import { StatutoryTab } from "./StatutoryTab";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const admin = as("admin");

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
  api.listDesignations.mockResolvedValue([
    { id: "des-guard", name: "Guard", detail: "G1" },
    { id: "des-sup", name: "Supervisor", detail: "G3" },
  ]);
  api.getAdminOverview.mockResolvedValue({ departments: [], managers: [] });
  api.listShifts.mockResolvedValue([]);
  api.updateEmployee.mockResolvedValue(undefined);
});

const user = () => userEvent.setup();
async function openTab(name: string) {
  await user().click(screen.getByRole("tab", { name }));
}
const shown = (select: HTMLElement) => (select as HTMLSelectElement).selectedOptions[0].textContent;

describe("the Personal tab's forms", () => {
  it("offers Indian, Nepali and Bangladeshi, and saves Indian for an empty record", async () => {
    const u = user();
    render(<EmployeeCardView card={{ ...admin, nationality: null }} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    const editor = screen.getByTestId("editor-identity");
    const nationality = within(editor).getByLabelText("Nationality") as HTMLSelectElement;
    expect([...nationality.options].map((o) => o.textContent)).toEqual([
      "Not recorded",
      "Indian",
      "Nepali",
      "Bangladeshi",
    ]);
    expect(shown(nationality)).toBe("Indian");
    await u.click(screen.getByTestId("save-identity"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { nationality: "Indian" });
  });

  it("keeps a nationality that is on record but not on the list", async () => {
    const u = user();
    render(<EmployeeCardView card={{ ...admin, nationality: "Sri Lankan" }} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    expect(shown(within(screen.getByTestId("editor-identity")).getByLabelText("Nationality"))).toBe(
      "Sri Lankan",
    );
  });

  it("takes experience before joining as years and months, and shows the total", async () => {
    const u = user();
    render(
      <EmployeeCardView
        card={{ ...admin, priorExperienceMonths: null, totalExperienceMonths: 50 }}
      />,
    );
    await openTab("Personal");
    await u.click(screen.getByRole("button", { name: "Edit education and experience" }));
    const editor = screen.getByTestId("editor-education");
    expect(within(editor).getByTestId("derived-totalExperience")).toHaveTextContent("4 yr 2 mo");
    await u.selectOptions(
      within(editor).getByLabelText("Experience before joining, years"),
      "2 years",
    );
    // Months not chosen yet count as none.
    expect(shown(within(editor).getByLabelText("Experience before joining, months"))).toBe(
      "0 months",
    );
    await u.selectOptions(
      within(editor).getByLabelText("Experience before joining, months"),
      "6 months",
    );
    await u.click(screen.getByTestId("save-education"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { priorExperienceMonths: "30" });
  });

  it("clears experience before joining when both are set back", async () => {
    const u = user();
    render(<EmployeeCardView card={{ ...admin, priorExperienceMonths: 14 }} />);
    await openTab("Personal");
    await u.click(screen.getByRole("button", { name: "Edit education and experience" }));
    const editor = screen.getByTestId("editor-education");
    const years = within(editor).getByLabelText("Experience before joining, years");
    const months = within(editor).getByLabelText("Experience before joining, months");
    expect([shown(years), shown(months)]).toEqual(["1 year", "2 months"]);
    // Setting either back to its blank clears both.
    await u.selectOptions(years, "Years");
    // (The test DOM leaves selectedOptions stale on a blank value; the value is right.)
    expect([(years as HTMLSelectElement).value, (months as HTMLSelectElement).value]).toEqual([
      "",
      "",
    ]);
    await u.click(screen.getByTestId("save-education"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { priorExperienceMonths: null });
  });

  it("chooses height, chest and weight from lists, and keeps a value outside them", async () => {
    const u = user();
    render(
      <EmployeeCardView
        card={{ ...admin, physical: { heightCm: 255, chestCm: null, weightKg: null } as never }}
      />,
    );
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-physical"));
    const editor = screen.getByTestId("editor-physical");
    const height = within(editor).getByLabelText("Height");
    expect(shown(height)).toBe("255");
    expect(within(height).getByRole("option", { name: "170 cm (5′ 7″)" })).toBeInTheDocument();
    await u.selectOptions(height, "170");
    await u.selectOptions(within(editor).getByLabelText("Chest"), "90 cm");
    await u.selectOptions(within(editor).getByLabelText("Weight"), "72 kg");
    await u.click(screen.getByTestId("save-physical"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, {
      heightCm: "170",
      chestCm: "90",
      weightKg: "72",
    });
  });

  it("says restricted data lives elsewhere in a note, not a panel of its own", async () => {
    render(<EmployeeCardView card={admin} />);
    await openTab("Personal");
    expect(screen.queryByTestId("panel-restricted")).toBeNull();
    expect(screen.getByTestId("restricted-note")).toHaveTextContent(
      "kept apart from this tab, on Statutory and bank",
    );
  });
});

describe("the Employment tab's forms", () => {
  it("shows the grade in the Position form, following the designation chosen", async () => {
    const u = user();
    render(
      <EmployeeCardView
        card={{ ...admin, designation: { id: "des-guard", name: "Guard", grade: "G1" } }}
      />,
    );
    await openTab("Employment");
    await u.click(screen.getByTestId("edit-position"));
    const editor = screen.getByTestId("editor-position");
    await within(editor).findByRole("option", { name: "Supervisor (G3)" });
    const grade = within(editor).getByTestId("derived-grade");
    expect(grade).toHaveTextContent("G1");
    await u.selectOptions(within(editor).getByLabelText("Designation"), "des-sup");
    expect(grade).toHaveTextContent("G3");
    await u.selectOptions(within(editor).getByLabelText("Designation"), "");
    expect(grade).toHaveTextContent("None");
  });
});

describe("deploying to a unit", () => {
  const card: EmployeeCard = { ...admin, currentDeployment: null };

  it("says what it still needs, and adds a unit from the dialog", async () => {
    const u = user();
    api.listActiveUnits
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: "u-new", name: "Tata AIG, Hosur", detail: "Tata AIG", calendar: null },
      ]);
    api.saveUnit.mockResolvedValue("u-new");
    api.moveUnit.mockResolvedValue(undefined);
    render(<EmployeeCardView card={card} />);
    await openTab("History");
    await u.click(screen.getByTestId("move-unit"));
    const select = screen.getByTestId("move-unit-select");
    await within(select).findByRole("option", { name: "No unit yet: add one below" });
    const deploy = screen.getByTestId("move-save");
    expect(deploy).toBeDisabled();
    expect(screen.getByTestId("move-missing")).toHaveTextContent(
      "Still needed: a unit, the order reference.",
    );

    await u.selectOptions(select, "Add a unit…");
    const add = screen.getByTestId("add-inline");
    await u.type(within(add).getByLabelText("New unit"), "Tata AIG, Hosur");
    await u.type(within(add).getByLabelText("Client (for a client site)"), "Tata AIG");
    await u.click(within(add).getByRole("button", { name: "Add" }));
    expect(api.saveUnit).toHaveBeenCalledWith(null, {
      name: "Tata AIG, Hosur",
      unitType: "client_site",
      clientName: "Tata AIG",
    });
    await within(select).findByRole("option", { name: "Tata AIG, Hosur (Tata AIG)" });
    expect(shown(select)).toBe("Tata AIG, Hosur (Tata AIG)");
    expect(screen.getByTestId("move-missing")).toHaveTextContent(
      "Still needed: the order reference.",
    );

    await u.type(screen.getByTestId("move-order-ref"), "DO/2026/114");
    expect(screen.queryByTestId("move-missing")).toBeNull();
    expect(deploy).toBeEnabled();
    await u.click(deploy);
    expect(api.moveUnit).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ unitId: "u-new", orderRef: "DO/2026/114" }),
    );
  });
});

describe("the Statutory and bank tab", () => {
  it("takes a photo of the passbook or a cancelled cheque on the bank panel", async () => {
    const u = user();
    api.uploadDocument.mockResolvedValue("doc-1");
    api.listDocuments.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: "doc-1",
        docType: "bank_proof",
        title: null,
        fileName: "cheque.jpg",
        sizeBytes: 2048,
        uploadedAt: "2026-10-13T10:00:00Z",
        uploadedBy: null,
        status: "uploaded",
      },
    ]);
    render(<StatutoryTab card={as("employeeAdmin")} onChanged={() => {}} />);
    const proof = screen.getByTestId("bank-proof");
    expect(await within(proof).findByText("not uploaded yet")).toBeInTheDocument();
    expect(within(proof).getByRole("button", { name: "Browse…" })).toBeInTheDocument();
    const file = new File(["jpg"], "cheque.jpg", { type: "image/jpeg" });
    await u.upload(within(proof).getByLabelText("Upload an image"), file);
    expect(within(proof).getByTestId("bank-proof-file-name")).toHaveTextContent("cheque.jpg");
    await u.click(within(proof).getByTestId("bank-proof-upload"));
    expect(api.uploadDocument).toHaveBeenCalledWith({
      employeeId: as("employeeAdmin").id,
      docType: "bank_proof",
      title: "",
      expiresOn: null,
      file,
    });
    expect(await within(proof).findByText("on file")).toBeInTheDocument();
    expect(within(proof).getByRole("button", { name: "View" })).toBeInTheDocument();
  });

  it("keeps a shown number's eye on the same line as the number", async () => {
    const u = user();
    api.revealRestricted.mockResolvedValue({ uan: "100200300400" });
    render(<StatutoryTab card={as("employeeAdmin")} onChanged={() => {}} />);
    await u.click(screen.getByRole("button", { name: "Show UAN" }));
    const hide = await screen.findByRole("button", { name: "Hide UAN" });
    // The number and its eye share one unbreakable line; the logged notice is apart.
    const line = hide.parentElement!;
    expect(line).toHaveClass("whitespace-nowrap");
    expect(line).toHaveTextContent("100200300400");
    expect(line).not.toHaveTextContent("Shown, logged");
    expect(screen.getByRole("button", { name: "Show EPF number" }).parentElement).toHaveClass(
      "whitespace-nowrap",
    );
  });
});

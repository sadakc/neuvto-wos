// @vitest-environment happy-dom

/**
 * Sada's third round of testing (D105), against real employee_card() output.
 * What it pins, screen by screen:
 *
 * - Native state is every state and union territory, Karnataka first and the
 *   default; height starts at 4 ft; a family row is "a family member";
 * - a nomination has no scheme: one covers them all;
 * - a move can end the current posting on its own day, the next one starting
 *   the day after unless the Admin says otherwise; the duration is years and
 *   months; the reason is the reason for deploying;
 * - the latest posting can be removed, with a reason, and the card says which
 *   posting carries on; a posting dated ahead is shown as where they go next;
 * - Change shift offers Save only for a change;
 * - an old UAN typed the same as the new one is refused; the driving licence
 *   replaces "Document given";
 * - a box with something in it has an x that clears it;
 * - an address starts with the state, and its districts follow it.
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
  listActiveUnits: vi.fn(),
  listDesignations: vi.fn(),
  getAdminOverview: vi.fn(),
  saveUnit: vi.fn(),
  moveUnit: vi.fn(),
  withdrawPosting: vi.fn(),
  updateEmployee: vi.fn(),
  saveNomination: vi.fn(),
  saveFamily: vi.fn(),
  addAddress: vi.fn(),
  attachAddressProof: vi.fn(),
  getRestrictedReads: vi.fn(),
  revealRestricted: vi.fn(),
  listChangeRequests: vi.fn(),
  listShifts: vi.fn(),
  setShift: vi.fn(),
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
const admin = as("employeeAdmin");

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
  api.listDesignations.mockResolvedValue([]);
  api.getAdminOverview.mockResolvedValue({ departments: [], managers: [] });
  api.listShifts.mockResolvedValue([]);
  api.listActiveUnits.mockResolvedValue([
    { id: "u-hq", name: "Acme HQ, Bengaluru", detail: null, calendar: null },
    { id: "u-new", name: "Belgaum Depot", detail: null, calendar: null },
  ]);
  api.updateEmployee.mockResolvedValue(undefined);
  api.moveUnit.mockResolvedValue(undefined);
});

const user = () => userEvent.setup();
async function openTab(name: string) {
  await user().click(screen.getByRole("tab", { name }));
}
const shown = (select: HTMLElement) => (select as HTMLSelectElement).selectedOptions[0].textContent;
const options = (select: HTMLElement) =>
  [...(select as HTMLSelectElement).options].map((o) => o.textContent);

describe("Personal and Family", () => {
  it("lists every state, Karnataka first and chosen, and saves it for an empty record", async () => {
    const u = user();
    render(<EmployeeCardView card={{ ...admin, nativeState: null }} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-identity"));
    const state = within(screen.getByTestId("editor-identity")).getByLabelText("Native state");
    expect(options(state).slice(0, 6)).toEqual([
      "Not recorded",
      "Karnataka",
      "Maharashtra",
      "Goa",
      "Andhra Pradesh",
      "Andaman and Nicobar Islands",
    ]);
    // 28 states and 8 union territories.
    expect(options(state)).toHaveLength(37);
    expect(shown(state)).toBe("Karnataka");
    await u.click(screen.getByTestId("save-identity"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { nativeState: "Karnataka" });
  });

  it("starts height at 4 ft", async () => {
    const u = user();
    render(<EmployeeCardView card={admin} />);
    await openTab("Personal");
    await u.click(screen.getByTestId("edit-physical"));
    const height = within(screen.getByTestId("editor-physical")).getByLabelText("Height");
    expect(options(height)[1]).toBe("122 cm (4′ 0″)");
  });

  it("adds a family member, not a relative", async () => {
    const u = user();
    render(<EmployeeCardView card={admin} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-family"));
    expect(screen.getByTestId("family-add-row")).toHaveTextContent("Add a family member");
  });

  it("makes one nomination for every scheme: no scheme to choose, none sent, none shown", async () => {
    const u = user();
    api.saveNomination.mockResolvedValue(undefined);
    render(<EmployeeCardView card={admin} />);
    await openTab("Family");
    expect(within(screen.getByTestId("nominee-table")).queryByText("Scheme")).toBeNull();
    await u.click(screen.getByTestId("edit-nominees"));
    const editor = screen.getByTestId("nominee-editor");
    expect(within(editor).queryByText("Scheme")).toBeNull();
    expect(editor).toHaveTextContent("One nomination covers PF, gratuity, ESIC and insurance");
    await u.click(screen.getByTestId("nominee-save"));
    expect(api.saveNomination).toHaveBeenCalledWith(
      admin.id,
      expect.not.objectContaining({ scheme: expect.anything() }),
    );
  });
});

describe("a box with something in it has an x that clears it", () => {
  it("clears the alternate mobile in one go, and saves it cleared", async () => {
    const u = user();
    render(<EmployeeCardView card={{ ...admin, alternateMobile: "9876543210" }} />);
    await u.click(screen.getByTestId("edit-contact"));
    const editor = screen.getByTestId("editor-contact");
    const box = within(editor).getByLabelText("Alternate mobile");
    expect(box).toHaveValue("9876543210");
    // Room is kept for the x, so text never runs under it.
    expect(box).toHaveClass("pr-11");
    await u.click(within(editor).getByRole("button", { name: "Clear Alternate mobile" }));
    expect(box).toHaveValue("");
    expect(within(editor).queryByRole("button", { name: "Clear Alternate mobile" })).toBeNull();
    await u.click(screen.getByTestId("save-contact"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { alternateMobile: null });
  });
});

describe("deployments", () => {
  it("ends the current posting on its own day and starts the next the day after", async () => {
    const u = user();
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    await u.click(screen.getByTestId("move-unit"));
    await screen.findByRole("option", { name: "Belgaum Depot" });
    await u.selectOptions(screen.getByTestId("move-unit-select"), "u-new");
    const ends = screen.getByRole("textbox", { name: "Last day at Tata AIG, Hosur" });
    const starts = screen.getByRole("textbox", { name: "Starts at the new unit on" });
    await u.type(ends, "10102026");
    expect(starts).toHaveValue("11/10/2026");

    // The Admin decides the start; the last day no longer moves it.
    await u.clear(starts);
    await u.type(starts, "15102026");
    await u.clear(ends);
    await u.type(ends, "09102026");
    expect(starts).toHaveValue("15/10/2026");

    await u.type(screen.getByTestId("move-order-ref"), "DO/26/9");
    await u.selectOptions(screen.getByLabelText("Expected duration, years"), "1 year");
    await u.selectOptions(screen.getByLabelText("Expected duration, months"), "6 months");
    await u.type(screen.getByLabelText("Reason for deploying"), "Client asked for two more");
    await u.click(screen.getByTestId("move-save"));
    expect(api.moveUnit).toHaveBeenCalledWith(admin.id, {
      unitId: "u-new",
      effectiveFrom: "2026-10-15",
      currentEndsOn: "2026-10-09",
      orderRef: "DO/26/9",
      expectedDuration: "1 year 6 months",
      reason: "Client asked for two more",
      keepOwnShift: false,
    });
  });

  it("refuses, on screen, a start on or before the last day", async () => {
    const u = user();
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    await u.click(screen.getByTestId("move-unit"));
    await screen.findByRole("option", { name: "Belgaum Depot" });
    await u.selectOptions(screen.getByTestId("move-unit-select"), "u-new");
    await u.type(screen.getByTestId("move-order-ref"), "DO/26/9");
    const starts = screen.getByRole("textbox", { name: "Starts at the new unit on" });
    await u.clear(starts);
    await u.type(starts, "10102026");
    await u.type(screen.getByRole("textbox", { name: "Last day at Tata AIG, Hosur" }), "10102026");
    await u.click(screen.getByTestId("move-save"));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The new posting has to start after 10 Oct 2026.",
    );
    expect(api.moveUnit).not.toHaveBeenCalled();
  });

  it("removes the latest posting only with a reason, and says which carries on", async () => {
    const u = user();
    api.withdrawPosting.mockResolvedValue({ unitName: "Tata AIG, Hosur", resumed: "Acme HQ" });
    const onChanged = vi.fn();
    render(<EmployeeCardView card={admin} onChanged={onChanged} />);
    await openTab("History");
    await u.click(screen.getByTestId("remove-posting"));
    expect(screen.getByTestId("remove-posting-what-happens")).toHaveTextContent(
      "Acme HQ, Bengaluru carries on as though this move had not been made.",
    );
    await u.click(screen.getByTestId("remove-posting-confirm"));
    expect(screen.getByTestId("remove-posting-error")).toHaveTextContent("Say why");
    expect(api.withdrawPosting).not.toHaveBeenCalled();
    await u.type(screen.getByTestId("remove-posting-reason"), "Added to the wrong unit");
    await u.click(screen.getByTestId("remove-posting-confirm"));
    // The latest posting, Tata AIG, never the older one.
    expect(api.withdrawPosting).toHaveBeenCalledWith(
      admin.deployments!.find((d) => d.unitName === "Tata AIG, Hosur")!.id,
      "Added to the wrong unit",
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows where somebody goes next, and the removed postings with why", async () => {
    render(
      <EmployeeCardView
        card={{
          ...admin,
          nextDeployment: { unitName: "Belgaum Depot", effectiveFrom: "2026-11-01" },
          withdrawnPostings: [
            {
              unitName: "Wrong Site",
              effectiveFrom: "2026-10-01",
              reason: "Added by mistake",
              withdrawnBy: "Hema HR",
              withdrawnAt: "2026-10-02T09:00:00Z",
            },
          ],
        }}
      />,
    );
    // The Overview's Current deployment has its own button now.
    expect(
      within(screen.getByTestId("panel-deployment")).getByTestId("move-unit"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("panel-deployment")).toHaveTextContent(
      "Moving toBelgaum Depot from 01 Nov 2026",
    );
    await openTab("History");
    expect(screen.getByTestId("withdrawn-postings")).toHaveTextContent(
      "Wrong Site from 01 Oct 2026, removed by Hema HR on 02 Oct 2026: Added by mistake",
    );
  });

  it("calls the dates panel Joining and exit dates", async () => {
    render(<EmployeeCardView card={admin} />);
    await openTab("Employment");
    expect(screen.getByText("Joining and exit dates")).toBeInTheDocument();
    expect(screen.queryByText("Dates and status")).toBeNull();
  });
});

describe("Change shift", () => {
  it("offers Save only for a change, and says why not", async () => {
    const u = user();
    api.listShifts.mockResolvedValue([
      {
        id: "s-night",
        name: "Night",
        startTime: "20:00",
        endTime: "08:00",
        breakMinutes: 30,
        status: "active",
      },
      {
        id: "s-day",
        name: "Day",
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 30,
        status: "active",
      },
    ]);
    render(<EmployeeCardView card={admin} />);
    await openTab("Employment");
    await u.click(screen.getByRole("button", { name: "Change shift" }));
    const shift = await screen.findByLabelText("Shift");
    await screen.findByRole("option", { name: /^Day/ });
    // It starts on what they work now, Night, so there is nothing to save.
    expect((shift as HTMLSelectElement).value).toBe("s-night");
    const save = screen.getByRole("button", { name: "Save shift" });
    expect(save).toBeDisabled();
    expect(screen.getByTestId("shift-unchanged")).toHaveTextContent("They already work Night.");
    // Typing a reason and taking it away again changes nothing.
    await u.type(screen.getByLabelText("Reason (optional)"), "x");
    await u.clear(screen.getByLabelText("Reason (optional)"));
    expect(save).toBeDisabled();
    await u.selectOptions(shift, "s-day");
    expect(save).toBeEnabled();
    expect(screen.queryByTestId("shift-unchanged")).toBeNull();
  });

  it("keeps a choice made while the list was still loading", async () => {
    const u = user();
    let resolve: (v: unknown) => void = () => {};
    api.listShifts.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<EmployeeCardView card={admin} />);
    await openTab("Employment");
    await u.click(screen.getByRole("button", { name: "Change shift" }));
    const shift = screen.getByLabelText("Shift") as HTMLSelectElement;
    await u.selectOptions(shift, "");
    resolve([
      {
        id: "s-night",
        name: "Night",
        startTime: "20:00",
        endTime: "08:00",
        breakMinutes: 30,
        status: "active",
      },
    ]);
    await screen.findByRole("option", { name: /^Night/ });
    // Their unit's shift, as chosen: not put back to Night by the list arriving.
    expect(shift.value).toBe("");
    expect(screen.getByRole("button", { name: "Save shift" })).toBeEnabled();
  });

  it("does not offer their unit's shift to somebody already on it", async () => {
    const u = user();
    api.listShifts.mockResolvedValue([
      {
        id: "s-day",
        name: "Day",
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 30,
        status: "active",
      },
    ]);
    const onUnit: EmployeeCard = {
      ...admin,
      workPattern: { ...admin.workPattern!, shiftSource: "unit", ownShifts: [] },
    };
    render(<EmployeeCardView card={onUnit} />);
    await openTab("Employment");
    await u.click(screen.getByRole("button", { name: "Change shift" }));
    await screen.findByRole("option", { name: /^Day/ });
    expect(screen.getByRole("button", { name: "Save shift" })).toBeDisabled();
    expect(screen.getByTestId("shift-unchanged")).toHaveTextContent(
      "They already work their unit's shift.",
    );
  });
});

describe("numbers", () => {
  it("refuses an old UAN or ESIC number typed the same as the new one", async () => {
    const u = user();
    const fresh: EmployeeCard = {
      ...admin,
      statutory: {
        ...admin.statutory!,
        uanLast4: null,
        oldUanLast4: null,
        esicLast4: null,
        oldEsicLast4: null,
      },
    };
    render(<StatutoryTab card={fresh} onChanged={() => {}} />);
    await u.click(screen.getByTestId("edit-pf"));
    const pf = screen.getByTestId("editor-pf");
    await u.type(within(pf).getByLabelText("UAN"), "100200300400");
    await u.type(within(pf).getByLabelText("Old UAN"), "1002 0030 0400");
    await u.type(within(pf).getByLabelText("ESIC number"), "1234567890");
    await u.type(within(pf).getByLabelText("Old ESIC number"), "1234567890");
    await u.click(screen.getByTestId("save-pf"));
    expect(
      within(pf)
        .getAllByRole("alert")
        .map((a) => a.textContent),
    ).toEqual([
      "The old UAN is the same as the current one. An old UAN is a previous account.",
      "The old ESIC number is the same as the current one. An old number is a previous one.",
    ]);
    expect(api.setStatutory).not.toHaveBeenCalled();
  });

  it("shows the driving licence where Document given was", async () => {
    const u = user();
    api.setStatutory.mockResolvedValue(undefined);
    render(
      <StatutoryTab
        card={{ ...admin, statutory: { ...admin.statutory!, licenceLast4: "2345" } }}
        onChanged={() => {}}
      />,
    );
    const panel = screen.getByTestId("panel-identity-docs");
    expect(panel).not.toHaveTextContent("Document given");
    expect(within(panel).getByTestId("licence-masked")).toHaveTextContent("•••• 2345");
    await u.click(screen.getByTestId("edit-identity-docs"));
    const editor = screen.getByTestId("editor-identity-docs");
    expect(within(editor).queryByText("Document given")).toBeNull();
    await u.click(within(editor).getByRole("button", { name: "Change Driving licence" }));
    await u.type(within(editor).getByLabelText("Driving licence"), "12345");
    await u.click(screen.getByTestId("save-identity-docs"));
    expect(within(editor).getByRole("alert")).toHaveTextContent(
      "starts with the state's two letters",
    );
    await u.clear(within(editor).getByLabelText("Driving licence"));
    await u.type(within(editor).getByLabelText("Driving licence"), "KA01 20110012345");
    await u.click(screen.getByTestId("save-identity-docs"));
    expect(api.setStatutory).toHaveBeenCalledWith(admin.id, {
      drivingLicence: "KA01 20110012345",
    });
  });
});

describe("an address", () => {
  it("starts with the state, Karnataka, and its districts follow it", async () => {
    const u = user();
    api.addAddress.mockResolvedValue([{ id: "a1", addressType: "present" }]);
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    await u.click(screen.getByTestId("add-address"));
    const state = screen.getByTestId("address-state");
    expect(shown(state)).toBe("Karnataka");
    const district = screen.getByTestId("address-district");
    expect(options(district)).toContain("Belagavi");
    await u.selectOptions(state, "Goa");
    expect(options(district)).toEqual(["Select", "North Goa", "South Goa", "Not listed: type it"]);
    // The state comes before the address line in the form.
    expect(
      state.compareDocumentPosition(screen.getByTestId("address-line")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("City/Town")).toBeInTheDocument();

    await u.selectOptions(district, "Not listed: type it");
    await u.type(screen.getByTestId("address-district-other"), "Canacona Taluka");
    await u.type(screen.getByTestId("address-line"), "12 Beach Road");
    await u.type(screen.getByTestId("address-city"), "Palolem");
    await u.type(screen.getByTestId("address-pincode"), "403702");
    await u.click(screen.getByTestId("address-save"));
    expect(api.addAddress).toHaveBeenCalledWith(
      admin.id,
      expect.objectContaining({
        state: "Goa",
        district: "Canacona Taluka",
        city: "Palolem",
        line: "12 Beach Road",
      }),
    );
  });
});

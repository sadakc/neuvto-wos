// @vitest-environment happy-dom

/**
 * Writing the record (E7), against real employee_card() output. What it pins:
 *
 * - only an Admin's card offers any control (criterion: no dead buttons);
 * - a third son is a third row, and the count updates as it is typed (1);
 * - the address dialog says what it will close before anything is typed, and
 *   a date clash lands on the date field (2);
 * - an archived row shows its real last day, the day before its successor (2);
 * - the unit is a select of active units, never the current one, and there is
 *   no text path to a unit (3, 4);
 * - shares off 100 keep Save disabled, with the total visible (5);
 * - a cleared field is sent as null; an untouched one is not sent at all.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(async () => []),
  listDocumentViews: vi.fn(async () => []),
  addAddress: vi.fn(),
  listActiveUnits: vi.fn(),
  listDesignations: vi.fn(),
  moveUnit: vi.fn(),
  saveFamily: vi.fn(),
  saveNomination: vi.fn(),
  savePreviousOrgs: vi.fn(),
  updateEmployee: vi.fn(),
  getRestrictedReads: vi.fn(),
  revealRestricted: vi.fn(),
  setStatutory: vi.fn(),
  setBank: vi.fn(),
  setRestricted: vi.fn(),
  listChangeRequests: vi.fn(),
  requestChange: vi.fn(),
  resolveChange: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";
import { shareTotal } from "../format";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const admin = as("admin");

beforeEach(() => {
  vi.resetAllMocks();
  api.listDesignations.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
  api.listChangeRequests.mockResolvedValue([]);
});

async function openTab(name: string) {
  await userEvent.setup().click(screen.getByRole("tab", { name }));
}

describe("who is offered a control", () => {
  it("offers nothing on your own card or a colleague's", async () => {
    for (const card of [as("self"), as("colleague")]) {
      const { unmount } = render(<EmployeeCardView card={card} />);
      for (const tab of screen.getAllByRole("tab")) {
        await userEvent.setup().click(tab);
        expect(
          screen.queryByRole("button", {
            name: /^(Edit|Add an|Move|Change nominees|Add nominees)/,
          }),
        ).toBeNull();
      }
      unmount();
    }
  });
});

describe("family", () => {
  it("takes a third son as a third row and counts him as he is added", async () => {
    const user = userEvent.setup();
    api.saveFamily.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<EmployeeCardView card={admin} onChanged={onChanged} />);
    await openTab("Family");
    await user.click(screen.getByTestId("edit-family"));
    expect(screen.getByTestId("family-editor-summary")).toHaveTextContent("2 sons, 1 daughter");

    await user.click(screen.getByTestId("family-add-row"));
    expect(screen.getByTestId("family-editor-summary")).toHaveTextContent("3 sons, 1 daughter");
    await user.type(screen.getByLabelText("Name, row 4"), "Vihaan");
    await user.click(screen.getByTestId("family-save"));

    const [, rows] = api.saveFamily.mock.calls[0];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r: { id?: string }) => r.id)).toHaveLength(3);
    expect(rows[3]).toMatchObject({ relation: "son", name: "Vihaan" });
    expect(rows[3].id).toBeUndefined();
    expect(onChanged).toHaveBeenCalled();
  });

  it("will not save a row with no name, and says so", async () => {
    const user = userEvent.setup();
    render(<EmployeeCardView card={admin} />);
    await openTab("Family");
    await user.click(screen.getByTestId("edit-family"));
    await user.click(screen.getByTestId("family-add-row"));
    await user.click(screen.getByTestId("family-save"));
    expect(screen.getByTestId("family-editor-error")).toHaveTextContent("needs a name");
    expect(api.saveFamily).not.toHaveBeenCalled();
  });
});

describe("nominees", () => {
  it("keeps Save off until the shares make exactly 100, with the total in view", async () => {
    const user = userEvent.setup();
    api.saveNomination.mockResolvedValue(undefined);
    render(<EmployeeCardView card={admin} />);
    await openTab("Family");
    await user.click(screen.getByTestId("edit-nominees"));
    expect(screen.getByTestId("nominee-total")).toHaveTextContent("Shares total 100%");

    const share = screen.getByLabelText("Share, row 1");
    await user.clear(share);
    await user.type(share, "60");
    expect(screen.getByTestId("nominee-total")).toHaveTextContent("Shares total 90%, must be 100");
    expect(screen.getByTestId("nominee-save")).toBeDisabled();

    await user.clear(share);
    await user.type(share, "70");
    expect(screen.getByTestId("nominee-save")).toBeEnabled();
    await user.click(screen.getByTestId("nominee-save"));
    expect(api.saveNomination).toHaveBeenCalledWith(
      admin.id,
      expect.objectContaining({
        nominees: expect.arrayContaining([expect.objectContaining({ sharePercent: 70 })]),
      }),
    );
  });

  it("does not round a third each up to 100", () => {
    expect(shareTotal([{ share: "33.33" }, { share: "33.33" }, { share: "33.33" }])).toBe(99.99);
    expect(shareTotal([{ share: "33.33" }, { share: "33.33" }, { share: "33.34" }])).toBe(100);
  });
});

describe("history", () => {
  it("shows an archived address's last day, the day before its successor", async () => {
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    const archived = within(screen.getByTestId("address-history"))
      .getAllByRole("row")
      .find((r) => r.textContent?.includes("Mysuru"))!;
    // Stored as an exclusive end of 1 Mar 2024, when its successor starts; it
    // last ran on 29 Feb.
    expect(archived).toHaveTextContent("29 Feb 2024");
    expect(archived).not.toHaveTextContent("01 Mar 2024");
  });

  it("says which address it closes before anything is typed, and puts a clash on the date", async () => {
    const user = userEvent.setup();
    api.addAddress.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "That date isn't after the current row's start.", 400, {
        code: "EFFECTIVE_DATE_CLASH",
      }),
    );
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    await user.click(screen.getByTestId("add-address"));

    expect(screen.getByTestId("address-what-happens")).toHaveTextContent(
      "closes the present address dated 01 Mar 2024",
    );
    expect(screen.getByTestId("address-save")).toHaveTextContent("Save and archive the old one");

    await user.type(screen.getByTestId("address-line"), "9 Lake View");
    await user.type(screen.getByTestId("address-city"), "Hosur");
    await user.type(screen.getByTestId("address-state"), "Tamil Nadu");
    await user.type(screen.getByTestId("address-pincode"), "635109");
    await user.click(screen.getByTestId("address-save"));

    const date = screen.getByTestId("address-from").closest("label")!;
    expect(within(date).getByRole("alert")).toHaveTextContent("isn't after");
    expect(screen.queryByTestId("address-error")).toBeNull();
  });

  it("offers active units by select, not the current one, and no text path to a unit", async () => {
    const user = userEvent.setup();
    api.listActiveUnits.mockResolvedValue([
      { id: admin.currentDeployment!.unitId, name: "Tata AIG, Hosur" },
      { id: "u-hq", name: "Acme HQ, Bengaluru" },
    ]);
    api.moveUnit.mockResolvedValue(undefined);
    render(<EmployeeCardView card={admin} />);
    await openTab("History");
    await user.click(screen.getByTestId("move-unit"));

    const select = (await screen.findByTestId("move-unit-select")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Acme HQ, Bengaluru" });
    const offered = [...select.options].map((o) => o.textContent);
    expect(offered).not.toContain("Tata AIG, Hosur");
    expect(screen.getByTestId("move-what-happens")).toHaveTextContent(
      "Currently at Tata AIG, Hosur",
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("textbox", { name: /unit/i })).toBeNull();

    expect(screen.getByTestId("move-save")).toBeDisabled();
    await user.selectOptions(select, "u-hq");
    await user.type(screen.getByTestId("move-order-ref"), "DO-2026-0007");
    await user.click(screen.getByTestId("move-save"));
    expect(api.moveUnit).toHaveBeenCalledWith(
      admin.id,
      expect.objectContaining({ unitId: "u-hq", orderRef: "DO-2026-0007" }),
    );
  });
});

describe("the record's own fields", () => {
  it("sends a cleared field as null and leaves untouched fields out", async () => {
    const user = userEvent.setup();
    api.updateEmployee.mockResolvedValue(undefined);
    render(<EmployeeCardView card={admin} />);
    await user.click(screen.getByTestId("edit-contact"));
    const editor = screen.getByTestId("editor-contact");
    const [altMobile] = within(editor).getAllByRole("textbox");
    expect(altMobile).toHaveValue("+91 98450 11122");
    await user.clear(altMobile);
    await user.click(screen.getByTestId("save-contact"));
    expect(api.updateEmployee).toHaveBeenCalledWith(admin.id, { alternateMobile: null });
  });
});

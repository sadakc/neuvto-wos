// @vitest-environment happy-dom

/**
 * Configuration (E9). What it pins:
 *
 * - a unit somebody is posted to cannot be retired from the screen, and says why;
 * - editing a unit says how many postings a rename will relabel, before saving;
 * - a client is asked for only for a client site, and a refusal keeps the dialog;
 * - an onboarding row saves only when changed and valid, and sends what was set;
 * - the reminder cadence and escalation window save within their limits, and
 *   the last reminder sent is shown (D99);
 * - the access section says every look at a record is logged (D100);
 * - the catalogue shows every field, with the new ones marked.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { UnitRow } from "../handlers";
import { FIELD_CATALOGUE } from "../fieldCatalogue";

const api = vi.hoisted(() => ({
  listUnits: vi.fn(),
  listAllDesignations: vi.fn(),
  saveUnit: vi.fn(),
  setUnitStatus: vi.fn(),
  saveDesignation: vi.fn(),
  setDesignationStatus: vi.fn(),
  listOnboardingItems: vi.fn(),
  saveOnboardingItem: vi.fn(),
  getOnboardingSettings: vi.fn(),
  saveOnboardingSettings: vi.fn(),
}));
vi.mock("../handlers", () => api);

import Configuration from "./Configuration";

const unit = (id: string, name: string, postedNow: number, postingsEver: number): UnitRow => ({
  id,
  name,
  unitType: "own_establishment",
  clientName: null,
  location: null,
  state: null,
  attendanceCaptureMode: null,
  requiresPoliceVerification: false,
  isBillable: false,
  status: "active",
  postedNow,
  postingsEver,
});

beforeEach(() => {
  vi.resetAllMocks();
  api.listUnits.mockResolvedValue([
    unit("u-busy", "Acme HQ", 3, 9),
    unit("u-empty", "Old Depot", 0, 2),
  ]);
  api.listAllDesignations.mockResolvedValue([]);
  api.listOnboardingItems.mockResolvedValue([
    { key: "uan", label: "UAN", dueWithinDays: 15, mandatory: true, customised: false },
  ]);
  api.getOnboardingSettings.mockResolvedValue({
    remindEveryDays: 3,
    escalateAfterDays: 7,
    lastReminder: { sentAt: "2026-10-12T03:30:00Z", people: 4 },
    lastEscalation: null,
  });
});

async function openUnits() {
  render(<Configuration />);
  await userEvent.setup().click(screen.getByTestId("config-units"));
  return screen.findAllByTestId("unit-row");
}

describe("deployment units", () => {
  it("will not retire a unit somebody is posted to, and retires an empty one", async () => {
    const user = userEvent.setup();
    api.setUnitStatus.mockResolvedValue(undefined);
    const [busy, empty] = await openUnits();
    const retireBusy = within(busy).getByTestId("toggle-unit");
    expect(retireBusy).toBeDisabled();
    expect(retireBusy).toHaveAttribute("title", expect.stringContaining("Move them first"));

    await user.click(within(empty).getByTestId("toggle-unit"));
    expect(api.setUnitStatus).toHaveBeenCalledWith("u-empty", "retired");
    expect(api.listUnits).toHaveBeenCalledTimes(2);
  });

  it("says how many postings a rename relabels, before anything is saved", async () => {
    const user = userEvent.setup();
    const [busy] = await openUnits();
    await user.click(within(busy).getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("unit-edit-warning")).toHaveTextContent(
      "3 people are posted here now, and 9 postings point at it",
    );
    expect(api.saveUnit).not.toHaveBeenCalled();
  });

  it("asks for a client only for a client site, and keeps the dialog open on a refusal", async () => {
    const user = userEvent.setup();
    api.saveUnit.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "There's already a unit with that name.", 400),
    );
    await openUnits();
    await user.click(screen.getByTestId("add-unit"));
    expect(screen.queryByTestId("unit-client")).toBeNull();
    await user.selectOptions(screen.getByTestId("unit-type"), "client_site");
    await user.type(screen.getByTestId("unit-name"), "Tata AIG, Hosur");
    await user.type(screen.getByTestId("unit-client"), "Tata AIG");
    await user.click(screen.getByTestId("unit-save"));
    expect(api.saveUnit).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        name: "Tata AIG, Hosur",
        unitType: "client_site",
        clientName: "Tata AIG",
      }),
    );
    expect(await screen.findByTestId("unit-error")).toHaveTextContent("already a unit");
    expect(screen.getByTestId("unit-name")).toHaveValue("Tata AIG, Hosur");
  });
});

describe("the onboarding checklist", () => {
  it("saves a row only when it changed and is valid, and sends what was set", async () => {
    const user = userEvent.setup();
    api.saveOnboardingItem.mockResolvedValue(undefined);
    render(<Configuration />);
    await user.click(screen.getByTestId("config-onboarding"));
    const row = await screen.findByTestId("onboarding-item");
    const save = within(row).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    const days = within(row).getByLabelText("UAN: days");
    await user.clear(days);
    await user.type(days, "400");
    expect(save).toBeDisabled();
    await user.clear(days);
    await user.type(days, "30");
    await user.click(within(row).getByLabelText("UAN: mandatory"));
    await user.click(save);
    expect(api.saveOnboardingItem).toHaveBeenCalledWith("uan", 30, false);
  });
});

describe("onboarding reminders", () => {
  it("saves the cadence and the escalation window within their limits", async () => {
    const user = userEvent.setup();
    api.saveOnboardingSettings.mockResolvedValue(undefined);
    render(<Configuration />);
    await user.click(screen.getByTestId("config-onboarding"));
    const box = await screen.findByTestId("onboarding-reminders");
    expect(box).toHaveTextContent("Last reminder 12 Oct 2026, 4 people.");
    expect(box).toHaveTextContent("No escalation sent yet.");
    const save = within(box).getByRole("button", { name: "Save reminders" });
    expect(save).toBeDisabled();

    const every = within(box).getByLabelText("Remind the Employee Admins every (days)");
    const after = within(box).getByLabelText("Tell the Super Admins after (days past due)");
    await user.clear(every);
    await user.type(every, "31");
    expect(save).toBeDisabled();
    await user.clear(every);
    await user.type(every, "5");
    await user.clear(after);
    await user.type(after, "91");
    expect(save).toBeDisabled();
    await user.clear(after);
    await user.type(after, "10");
    await user.click(save);
    expect(api.saveOnboardingSettings).toHaveBeenCalledWith(5, 10);
  });

  it("says that 0 switches each one off", async () => {
    render(<Configuration />);
    await userEvent.setup().click(screen.getByTestId("config-onboarding"));
    expect(await screen.findByTestId("onboarding-reminders")).toHaveTextContent(
      "0 switches it off.",
    );
  });
});

describe("access", () => {
  it("says every look at somebody's record is logged", async () => {
    render(<Configuration />);
    await userEvent.setup().click(screen.getByTestId("config-access"));
    expect(
      await screen.findByText(/Every look at somebody else's record is logged too/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not built yet/)).toBeNull();
  });
});

describe("the field catalogue", () => {
  it("lists every field, and marks the ones the sheet never had", () => {
    render(<Configuration />);
    const rows = within(screen.getByTestId("field-catalogue")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(FIELD_CATALOGUE.length);
    const newOnes = rows.filter((r) => within(r).queryByText("new"));
    expect(newOnes).toHaveLength(FIELD_CATALOGUE.filter((f) => f.sheet === "new").length);
  });
});

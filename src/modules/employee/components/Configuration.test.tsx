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
 * - calendars and shifts (D102): a new calendar starts Sunday off and sends
 *   the days ticked; the Company calendar is set on Settings, not here; a
 *   night shift says it ends the next day; nothing in use can be retired;
 * - a unit picks its calendar and default shift from active ones only;
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
  listCalendars: vi.fn(),
  saveCalendar: vi.fn(),
  setCalendarStatus: vi.fn(),
  listShifts: vi.fn(),
  saveShift: vi.fn(),
  setShiftStatus: vi.fn(),
}));
vi.mock("../handlers", () => api);

import Configuration from "./Configuration";

const unit = (id: string, name: string, postedNow: number, postingsEver: number): UnitRow => ({
  workingCalendarId: null,
  defaultShiftId: null,
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
  api.listCalendars.mockResolvedValue([
    {
      id: "c-co",
      name: "Company calendar",
      weeklyOff: [0, 6],
      isDefault: true,
      status: "active",
      units: 1,
    },
    {
      id: "c-six",
      name: "Six-day sites",
      weeklyOff: [0],
      isDefault: false,
      status: "active",
      units: 2,
    },
    { id: "c-spare", name: "Spare", weeklyOff: [0], isDefault: false, status: "active", units: 0 },
    {
      id: "c-old",
      name: "Old week",
      weeklyOff: [5],
      isDefault: false,
      status: "retired",
      units: 0,
    },
  ]);
  api.listShifts.mockResolvedValue([
    {
      id: "s-gen",
      name: "General",
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
      status: "active",
      units: 1,
      people: 0,
    },
    {
      id: "s-night",
      name: "Night",
      startTime: "20:00",
      endTime: "08:00",
      breakMinutes: 30,
      status: "active",
      units: 0,
      people: 0,
    },
    {
      id: "s-old",
      name: "Retired one",
      startTime: "06:00",
      endTime: "14:00",
      breakMinutes: 0,
      status: "retired",
      units: 0,
      people: 0,
    },
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

describe("calendars and shifts", () => {
  async function open() {
    render(<Configuration />);
    await userEvent.setup().click(screen.getByTestId("config-calendars"));
    return screen.findAllByTestId("calendar-row");
  }

  it("adds a calendar starting Sunday off, sending the days ticked", async () => {
    const user = userEvent.setup();
    api.saveCalendar.mockResolvedValue("c-new");
    await open();
    await user.click(screen.getByRole("button", { name: "Add a calendar" }));
    const form = screen.getByTestId("calendar-form");
    expect(within(form).getByLabelText("Sunday")).toBeChecked();
    expect(within(form).getByLabelText("Saturday")).not.toBeChecked();
    await user.type(within(form).getByLabelText("Name"), "Five-day offices");
    await user.click(within(form).getByLabelText("Saturday"));
    await user.click(within(form).getByRole("button", { name: "Save calendar" }));
    expect(api.saveCalendar).toHaveBeenCalledWith(null, {
      name: "Five-day offices",
      weeklyOff: [0, 6],
    });
  });

  it("will not save a week with no working day", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add a calendar" }));
    const form = screen.getByTestId("calendar-form");
    await user.type(within(form).getByLabelText("Name"), "Never");
    for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      await user.click(within(form).getByLabelText(d));
    }
    expect(within(form).getByRole("button", { name: "Save calendar" })).toBeDisabled();
  });

  it("sends the Company calendar to Settings and retires only what nothing uses", async () => {
    const user = userEvent.setup();
    api.setCalendarStatus.mockResolvedValue(undefined);
    const rows = await open();
    const company = rows.find((r) => r.textContent?.includes("Company calendar"))!;
    expect(company).toHaveTextContent("Saturday and Sunday off");
    expect(company).toHaveTextContent("Set on Settings");
    expect(within(company).queryAllByRole("button")).toHaveLength(0);
    const busy = rows.find((r) => r.textContent?.includes("Six-day sites"))!;
    expect(within(busy).getByRole("button", { name: "Retire" })).toBeDisabled();
    const spare = rows.find((r) => r.textContent?.includes("Spare"))!;
    await user.click(within(spare).getByRole("button", { name: "Retire" }));
    expect(api.setCalendarStatus).toHaveBeenCalledWith("c-spare", "retired");
  });

  it("adds a shift, says a night shift ends the next day, and will not retire one in use", async () => {
    const user = userEvent.setup();
    api.saveShift.mockResolvedValue("s-new");
    await open();
    const rows = await screen.findAllByTestId("shift-row");
    const night = rows.find((r) => r.textContent?.includes("Night"))!;
    expect(night).toHaveTextContent("20:00 to 08:00 next day, 30 min break");
    const general = rows.find((r) => r.textContent?.includes("General"))!;
    expect(within(general).getByRole("button", { name: "Retire" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add a shift" }));
    const form = screen.getByTestId("shift-form");
    await user.type(within(form).getByLabelText("Name"), "Morning");
    await user.type(within(form).getByLabelText("Starts"), "06:00");
    await user.type(within(form).getByLabelText("Ends"), "14:00");
    await user.clear(within(form).getByLabelText("Unpaid break (minutes)"));
    await user.type(within(form).getByLabelText("Unpaid break (minutes)"), "30");
    await user.click(within(form).getByRole("button", { name: "Save shift" }));
    expect(api.saveShift).toHaveBeenCalledWith(null, {
      name: "Morning",
      startTime: "06:00",
      endTime: "14:00",
      breakMinutes: 30,
    });
  });
});

describe("a unit's calendar and shift", () => {
  it("picks from active calendars and shifts, and sends both", async () => {
    const user = userEvent.setup();
    api.saveUnit.mockResolvedValue("u-busy");
    render(<Configuration />);
    await user.click(screen.getByTestId("config-units"));
    const rows = await screen.findAllByTestId("unit-row");
    await user.click(within(rows[0]).getByRole("button", { name: "Edit" }));
    const cal = await screen.findByLabelText("Working calendar");
    await within(cal).findByRole("option", { name: /Six-day sites/ });
    expect(within(cal).queryByRole("option", { name: /Old week/ })).toBeNull();
    const shift = screen.getByLabelText("Default shift");
    expect(within(shift).queryByRole("option", { name: /Retired one/ })).toBeNull();
    await user.selectOptions(cal, "c-six");
    await user.selectOptions(shift, "s-night");
    await user.click(screen.getByTestId("unit-save"));
    expect(api.saveUnit).toHaveBeenCalledWith(
      "u-busy",
      expect.objectContaining({ workingCalendarId: "c-six", defaultShiftId: "s-night" }),
    );
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

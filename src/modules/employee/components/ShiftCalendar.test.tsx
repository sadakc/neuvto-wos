// @vitest-environment happy-dom

/**
 * Shift and calendar (D102), against real employee_card() output. What it pins:
 *
 * - the Employment tab says which calendar and shift a person works, and
 *   where each comes from; a night shift says it ends the next day;
 * - the own-shift history is shown only where the card carried it;
 * - only an Admin is offered Change shift; it sends the shift, or null for
 *   "their unit's shift", from a date, and a clash lands on the date;
 * - moving somebody with their own shift asks whether to keep it, and says
 *   which calendar their leave will be counted on from the move.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { EmployeeCard } from "../contracts";
import { describeWeek } from "../format";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listChangeRequests: vi.fn(),
  getRestrictedReads: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentViews: vi.fn(),
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  listDesignations: vi.fn(),
  listActiveUnits: vi.fn(),
  moveUnit: vi.fn(),
  listShifts: vi.fn(),
  setShift: vi.fn(),
  getAdminOverview: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("../recordExport", () => ({ downloadRecordPdf: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;

beforeEach(() => {
  vi.resetAllMocks();
  api.listChangeRequests.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
  api.listDocuments.mockResolvedValue([]);
  api.listDocumentViews.mockResolvedValue([]);
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.listDesignations.mockResolvedValue([]);
  api.getAdminOverview.mockResolvedValue({ departments: [], managers: [] });
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
  api.listActiveUnits.mockResolvedValue([
    {
      id: "u-hq",
      name: "Acme HQ, Bengaluru",
      detail: null,
      calendar: { name: "Company calendar", weeklyOff: [0, 6] },
    },
  ]);
});

async function openTab(name: string) {
  await userEvent.setup().click(screen.getByRole("tab", { name }));
}

describe("the week in words", () => {
  it("names the days off, Monday first", () => {
    expect(describeWeek([0])).toBe("Sunday off");
    expect(describeWeek([0, 6])).toBe("Saturday and Sunday off");
    expect(describeWeek([5, 6])).toBe("Friday and Saturday off");
    expect(describeWeek([0, 3, 6])).toBe("Wednesday, Saturday and Sunday off");
    expect(describeWeek([])).toBe("No weekly off");
  });
});

describe("shift and calendar on the card", () => {
  it("says which calendar and shift a colleague works, and where each comes from", async () => {
    render(<EmployeeCardView card={as("colleague")} />);
    await openTab("Employment");
    const panel = screen.getByTestId("panel-shift-calendar");
    expect(panel).toHaveTextContent("Six-day sites");
    expect(panel).toHaveTextContent("Sunday off");
    expect(panel).toHaveTextContent("Set byTheir unit, Tata AIG, Hosur");
    // Said once: the label is "Set by", never "Calendar from: From …".
    expect(panel).not.toHaveTextContent(/from From/i);
    expect(panel).toHaveTextContent("Night");
    expect(panel).toHaveTextContent("20:00 to 08:00 next day, 30 min break");
    expect(panel).toHaveTextContent("Their own shift, since 01 Jul 2025");
    expect(screen.queryByTestId("own-shift-history")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change shift" })).toBeNull();
  });

  it("shows the person their own-shift history", async () => {
    render(<EmployeeCardView card={as("self")} />);
    await openTab("Employment");
    const history = screen.getByTestId("own-shift-history");
    expect(history).toHaveTextContent("Night");
    expect(history).toHaveTextContent("01 Jul 2025");
    expect(history).toHaveTextContent("Night post at the gate");
    expect(screen.queryByRole("button", { name: "Change shift" })).toBeNull();
  });

  it("lets an Admin set a shift from a date, offering only shifts in use", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const card = as("employeeAdmin");
    api.setShift.mockResolvedValue(undefined);
    render(<EmployeeCardView card={card} onChanged={onChanged} />);
    await openTab("Employment");
    await user.click(screen.getByRole("button", { name: "Change shift" }));
    const select = await screen.findByLabelText("Shift");
    await screen.findByRole("option", { name: /General/ });
    expect(within(select).queryByRole("option", { name: /Retired one/ })).toBeNull();
    await user.selectOptions(select, "s-gen");
    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2026-12-01");
    await user.type(screen.getByLabelText("Reason (optional)"), "Back to days");
    await user.click(screen.getByRole("button", { name: "Save shift" }));
    expect(api.setShift).toHaveBeenCalledWith(card.id, {
      shiftId: "s-gen",
      effectiveFrom: "2026-12-01",
      reason: "Back to days",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("sends null to return them to their unit's shift, and puts a clash on the date", async () => {
    const user = userEvent.setup();
    const card = as("employeeAdmin");
    api.setShift.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "That date clashes.", 400, {
        code: "EFFECTIVE_DATE_CLASH",
      }),
    );
    render(<EmployeeCardView card={card} />);
    await openTab("Employment");
    await user.click(screen.getByRole("button", { name: "Change shift" }));
    await screen.findByRole("option", { name: /General/ });
    await user.selectOptions(screen.getByLabelText("Shift"), "");
    await user.click(screen.getByRole("button", { name: "Save shift" }));
    expect(api.setShift).toHaveBeenCalledWith(card.id, expect.objectContaining({ shiftId: null }));
    const date = screen.getByLabelText("From").closest("label")!;
    expect(await within(date).findByRole("alert")).toHaveTextContent("That date clashes.");
  });
});

describe("moving somebody with their own shift", () => {
  it("asks whether to keep it, and says which calendar leave is counted on", async () => {
    const user = userEvent.setup();
    const card = as("employeeAdmin");
    api.moveUnit.mockResolvedValue(undefined);
    render(<EmployeeCardView card={card} />);
    await openTab("History");
    await user.click(screen.getByTestId("move-unit"));
    await screen.findByRole("option", { name: "Acme HQ, Bengaluru" });
    await user.selectOptions(screen.getByTestId("move-unit-select"), "u-hq");
    await user.clear(screen.getByTestId("move-from"));
    await user.type(screen.getByTestId("move-from"), "2026-12-01");
    expect(screen.getByTestId("move-calendar-note")).toHaveTextContent(
      "From 01 Dec 2026 their leave is counted on Company calendar: Saturday and Sunday off.",
    );
    const keep = screen.getByLabelText("Keep their own shift (Night)");
    expect(keep).not.toBeChecked();
    await user.type(screen.getByTestId("move-order-ref"), "DO-9");
    await user.click(screen.getByTestId("move-save"));
    expect(api.moveUnit).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ unitId: "u-hq", keepOwnShift: false }),
    );
  });

  it("does not ask about a shift a person does not have", async () => {
    const user = userEvent.setup();
    const card = as("employeeAdmin");
    const plain = {
      ...card,
      workPattern: { ...card.workPattern!, shiftSource: "unit", ownShiftSince: null },
    } as EmployeeCard;
    render(<EmployeeCardView card={plain} />);
    await openTab("History");
    await user.click(screen.getByTestId("move-unit"));
    await screen.findByRole("option", { name: "Acme HQ, Bengaluru" });
    expect(screen.queryByLabelText(/Keep their own shift/)).toBeNull();
  });
});

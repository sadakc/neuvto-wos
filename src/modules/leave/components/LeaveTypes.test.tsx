// @vitest-environment happy-dom

/**
 * Two settings that looked like duplicates, and the screen that made them
 * look like it.
 *
 * The workspace has a default notice period; a leave type may set its own. The
 * database resolves `coalesce(type.min_notice_days, org.default_min_notice_days,
 * 0)` — so a type that leaves notice BLANK inherits the workspace figure, and
 * that is the only way the workspace figure is ever used.
 *
 * This form pre-filled "Notice needed" with "0". Every leave type ever created
 * through it therefore carried an explicit zero, which overrode the default,
 * while the helper text underneath said "Blank uses the workspace default". The
 * setting was not broken. It was unreachable, and nothing on screen said so.
 *
 * The row summary had the same fault from the other end: it rendered notice with
 * `t.minNoticeDays ? … : ""`, which is silent for both null and 0 — so "inherits
 * the workspace default" and "explicitly needs none" printed identically.
 *
 * Neither is catchable below the render. Both are pinned here, and every test
 * below was watched failing — against the old default, the old summary, or the
 * old load — before it was believed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LeaveType, LeaveTypeInput } from "../contracts";

// ── the seam
//
// Three data calls, all of them RPCs. Everything below the component is
// replaced; nothing about the component is. `contracts` (the Zod schema the
// form parses against) is left real deliberately — mocking it would leave this
// suite passing against a form that saves nonsense.

const listLeaveTypes = vi.fn<() => Promise<LeaveType[]>>();
const saveLeaveType = vi.fn<(input: LeaveTypeInput, organizationId: string) => Promise<void>>(
  async () => {},
);
const setLeaveTypeStatus = vi.fn<(id: string, status: string) => Promise<void>>(async () => {});

vi.mock("../handlers", () => ({
  listLeaveTypes: () => listLeaveTypes(),
  saveLeaveType: (input: LeaveTypeInput, organizationId: string) =>
    saveLeaveType(input, organizationId),
  setLeaveTypeStatus: (id: string, status: string) => setLeaveTypeStatus(id, status),
}));

vi.mock("@/platform/auth", () => ({
  getCurrentUser: async () => ({
    id: "alice-id",
    email: "alice.admin@acme.test",
    fullName: "Alice Admin",
    organizationId: "org",
    organizationName: "Acme",
    roles: ["org_admin"],
  }),
}));

const getOrgSettings = vi.fn<() => Promise<{ defaultMinNoticeDays: number } | null>>();
vi.mock("@/platform/calendar", () => ({ getOrgSettings: () => getOrgSettings() }));

import LeaveTypes from "./LeaveTypes";

/**
 * The three notice cases, on one screen, because that is how an administrator
 * meets them — not one at a time in a fixture built to make the assertion easy.
 *
 * Casual is the case that matters: it inherits, and under the old rendering it
 * was indistinguishable from Emergency, which is the opposite instruction.
 */
const CASUAL: LeaveType = {
  id: "casual",
  name: "Casual leave",
  description: null,
  maxDaysPerYear: 12,
  minNoticeDays: null, // inherits the workspace default
  maxPerRequest: null,
  approvalRequired: true,
  status: "active",
};

const EMERGENCY: LeaveType = {
  ...CASUAL,
  id: "emergency",
  name: "Emergency leave",
  maxDaysPerYear: 3,
  minNoticeDays: 0, // explicitly none — you cannot give notice of an emergency
};

const ANNUAL: LeaveType = {
  ...CASUAL,
  id: "annual",
  name: "Annual leave",
  maxDaysPerYear: 18,
  minNoticeDays: 7, // its own figure, higher than the workspace default
};

const WORKSPACE_DEFAULT = 5;

const rowFor = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('[data-testid="leave-type-row"]');
  if (!row) throw new Error(`no row rendered for the leave type "${name}"`);
  return row as HTMLElement;
};

const noticeField = () => screen.getByLabelText("Notice needed") as HTMLInputElement;

async function renderSettled() {
  render(<LeaveTypes />);
  // The skeleton gives way when the types land; the settings read lands
  // separately and may be later or never.
  await screen.findByText("Casual leave");
}

beforeEach(() => {
  vi.clearAllMocks();
  listLeaveTypes.mockResolvedValue([CASUAL, EMERGENCY, ANNUAL]);
  getOrgSettings.mockResolvedValue({ defaultMinNoticeDays: WORKSPACE_DEFAULT });
});

describe("LeaveTypes — the notice default", () => {
  it("opens the add form with Notice needed EMPTY", async () => {
    // THE FIX, in one assertion. A "0" here is not a suggestion — it is a
    // decision, silently made on the administrator's behalf, that this type
    // overrides the workspace default with "none".
    const user = userEvent.setup();
    await renderSettled();

    await user.click(screen.getByTestId("add-leave-type"));

    expect(noticeField().value).toBe("");
    // Days a year still carries its suggestion of 12 — blankness here is
    // specific to notice, not the form giving up on defaults.
    expect((screen.getByLabelText("Days a year") as HTMLInputElement).value).toBe("12");
  });

  it("shows the inherited number as the placeholder, so blank is visibly a choice", async () => {
    // An empty box with nothing else said reads as an omission. The workspace
    // figure sitting in grey is what makes leaving it alone deliberate.
    const user = userEvent.setup();
    await renderSettled();

    await user.click(screen.getByTestId("add-leave-type"));

    expect(noticeField()).toHaveAttribute("placeholder", String(WORKSPACE_DEFAULT));
    expect(
      screen.getByText(`Days. Blank uses the workspace default of ${WORKSPACE_DEFAULT}`),
    ).toBeInTheDocument();
  });

  it("sends a blank notice to the handler as 'inherit', not as zero", async () => {
    // The half of the fix that leaves the screen. A blank box has to arrive as
    // null — `coalesce(type.min_notice_days, org.default_min_notice_days, 0)`
    // only ever reaches the workspace figure when this column is null, and the
    // schema (real here, not mocked) is what turns "" into it.
    const user = userEvent.setup();
    await renderSettled();

    await user.click(screen.getByTestId("add-leave-type"));
    await user.type(screen.getByLabelText("Name"), "Sabbatical");
    await user.click(screen.getByTestId("save-leave-type"));

    await waitFor(() => expect(saveLeaveType).toHaveBeenCalledTimes(1));
    expect(saveLeaveType.mock.calls[0][0]).toMatchObject({
      name: "Sabbatical",
      minNoticeDays: null,
    });
    expect(screen.queryByTestId("leave-type-error")).toBeNull();
  });

  it("reports what is stored when an existing type is edited", async () => {
    // The control-misreports-state case. A type that inherits must open blank,
    // and a type explicitly set to zero must open showing 0 — if either lies,
    // pressing Save writes the other one's meaning.
    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(rowFor("Casual leave")).getByRole("button", { name: "Edit" }));
    expect(noticeField().value).toBe("");

    await user.click(within(rowFor("Emergency leave")).getByRole("button", { name: "Edit" }));
    expect(noticeField().value).toBe("0");

    await user.click(within(rowFor("Annual leave")).getByRole("button", { name: "Edit" }));
    expect(noticeField().value).toBe("7");
  });
});

describe("LeaveTypes — the row summary", () => {
  it("tells inherited, none and a set number apart", async () => {
    // Previously null and 0 both rendered nothing at all, so two of these three
    // rows read identically while meaning opposite things.
    await renderSettled();

    // The settings read lands after the list, so the inherited sentence is the
    // one to wait for rather than assert straight away.
    await waitFor(() =>
      expect(rowFor("Casual leave")).toHaveTextContent("5 days' notice (workspace default)"),
    );

    const casual = rowFor("Casual leave");
    const emergency = rowFor("Emergency leave");
    const annual = rowFor("Annual leave");

    expect(emergency).toHaveTextContent("no notice needed");
    expect(annual).toHaveTextContent("7 days' notice");

    // …and are genuinely three different sentences, not three ways of saying
    // nothing. Names stripped so the comparison is about the notice line.
    const summary = (row: HTMLElement) => within(row).getByText(/a year/).textContent ?? "";
    const [c, e, a] = [summary(casual), summary(emergency), summary(annual)];
    expect(new Set([c, e, a]).size).toBe(3);
    expect(e).not.toMatch(/workspace default/);
    expect(a).not.toMatch(/workspace default/);
  });

  it("does not invent a number when the workspace default is unknown", async () => {
    // The settings read failed. "Notice: the workspace default" is honest; a
    // figure would not be, and silence is what the old code did.
    getOrgSettings.mockRejectedValue(new Error("settings unavailable"));
    await renderSettled();

    const casual = rowFor("Casual leave");
    expect(casual).toHaveTextContent("notice: the workspace default");
    expect(casual).not.toHaveTextContent(/\d+ days' notice/);
  });

  it("still lists the leave types when the settings read fails", async () => {
    // The settings call is decoration — it names a number in a summary line.
    // Configuring leave types, which is what this screen is FOR, works without
    // it, so a failure there must not blank the screen.
    getOrgSettings.mockRejectedValue(new Error("settings unavailable"));
    render(<LeaveTypes />);

    expect(await screen.findAllByTestId("leave-type-row")).toHaveLength(3);
    expect(screen.getByTestId("add-leave-type")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load your leave types/i)).toBeNull();
  });
});

describe("LeaveTypes — half days", () => {
  it("accepts a half day in Days a year and in Most at a time", async () => {
    // Entitlement is counted in halves, so 12.5 days a year and a half-day cap
    // are both ordinary. A number input whose step is 1 refuses 12.5 — the form
    // will not submit and the browser puts up its own tooltip, which no amount
    // of server-side tolerance rescues.
    const user = userEvent.setup();
    await renderSettled();

    await user.click(screen.getByTestId("add-leave-type"));

    const days = screen.getByLabelText("Days a year") as HTMLInputElement;
    await user.clear(days);
    await user.type(days, "12.5");
    expect(days.value).toBe("12.5");
    expect(days.validity.stepMismatch).toBe(false);
    expect(days.checkValidity()).toBe(true);

    const most = screen.getByLabelText("Most at a time") as HTMLInputElement;
    await user.type(most, "0.5");
    expect(most.value).toBe("0.5");
    // 0.5 is both a step and a range question: `min` was 1.
    expect(most.validity.stepMismatch).toBe(false);
    expect(most.validity.rangeUnderflow).toBe(false);
    expect(most.checkValidity()).toBe(true);
  });
});

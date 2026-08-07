// @vitest-environment happy-dom

/**
 * A sentence that was wrong about the database.
 *
 * "Minimum notice — Days. A leave type can require more" described a rule the
 * product does not have. Notice resolves as
 *
 *     coalesce(type.min_notice_days, org.default_min_notice_days, 0)
 *
 * so a type's own figure WINS in both directions: an emergency type set to 0
 * against a workspace default of 5 needs no notice at all, and nothing warns
 * anybody. An administrator who read the old line would reasonably believe the
 * workspace figure was a floor. It is a fallback.
 *
 * Sada asked whether the workspace setting and the per-type setting were
 * duplicates. This wording is part of why they looked like it, so this test is
 * about the claim rather than the prose: it must not promise "more".
 *
 * Watched failing against the old wording before it was believed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// ── the seam
//
// The calendar service is four RPCs. The component is the thing under test;
// everything it reads is replaced. `getFinancialYear` is here because the
// component calls it — leaving it unmocked would import the real Supabase
// client and this test would be about environment variables.
const getOrgSettings = vi.fn();
const getFinancialYear = vi.fn(async () => "2026–27");
const saveOrgSettings = vi.fn(async () => {});

vi.mock("./index", () => ({
  getOrgSettings: () => getOrgSettings(),
  getFinancialYear: (...a: unknown[]) => getFinancialYear(...(a as [])),
  saveOrgSettings: (...a: unknown[]) => saveOrgSettings(...(a as [])),
}));

import { WorkingCalendar } from "./WorkingCalendar";

/** A five-day week with a real notice period, which is the case that misleads. */
const SETTINGS = {
  timezone: "Asia/Kolkata",
  fyStartMonth: 4,
  fyStartDay: 1,
  weekendDays: [0, 6],
  excludeWeekends: true,
  excludeHolidays: true,
  allowRetroactive: false,
  defaultMinNoticeDays: 5,
  nextFyOpensMonthsBefore: 1,
  sessionIdleMinutes: 30,
  sessionAbsoluteHours: 12,
};

beforeEach(() => {
  vi.clearAllMocks();
  getOrgSettings.mockResolvedValue(SETTINGS);
});

describe("WorkingCalendar — minimum notice", () => {
  it("does not promise that a leave type can only require MORE", async () => {
    render(<WorkingCalendar organizationId="org" />);

    const notice = (await screen.findByLabelText("Minimum notice")) as HTMLInputElement;
    // The field is bound to the stored figure, so the helper below genuinely
    // describes this control rather than floating near it.
    expect(notice).toHaveValue(5);

    const field = notice.closest("div");
    if (!field) throw new Error("the Minimum notice input is not wrapped in a field container");
    const help = within(field as HTMLElement).getByText(/^Days\./);

    // The claim that was false, in the words it was made in.
    expect(help.textContent ?? "").not.toMatch(/require more/i);

    // And what is true in its place: the type's own number is used instead, in
    // whichever direction.
    expect(help).toHaveTextContent(/uses that instead/i);
    expect(help).toHaveTextContent(/higher or lower/i);
  });
});

/**
 * The bug screen-prover found while pinning the sentence above, fixed in the
 * same PR because it is the same defect one layer up.
 *
 * Every numeric box here was `update(key, Number(e.target.value))`, and
 * `Number("") === 0`. Clearing "Minimum notice" to type a new figure set the
 * workspace default to "no notice at all" — and `org_settings_notice` permits 0,
 * so Save accepted it silently. The whole subject of this PR is a stray zero in
 * a notice field overriding something; this was the same stray zero in the very
 * control Sada screenshotted.
 *
 * `fyStartDay` hid it better and behaved worse: `org_settings_fy_day` requires
 * 1 to 31, so an emptied box produced a FAILED save complaining about a day of
 * the month nobody typed.
 */
describe("WorkingCalendar — a cleared box is not zero", () => {
  it("does not turn an emptied notice field into 'no notice'", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<WorkingCalendar organizationId="org" />);

    const notice = (await screen.findByLabelText("Minimum notice")) as HTMLInputElement;
    expect(notice).toHaveValue(5);

    await user.clear(notice);
    // The box is empty because that is what was typed — NOT snapped to 0, which
    // is a value nobody chose and which saves without complaint.
    expect(notice.value).toBe("");

    await user.click(screen.getByRole("button", { name: /save/i }));

    // The decisive assertion: what actually reached the database.
    expect(saveOrgSettings).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ defaultMinNoticeDays: 5 }),
    );
  });

  it("restores the stored figure when an emptied box loses focus", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<WorkingCalendar organizationId="org" />);

    const day = (await screen.findByLabelText("Day of month")) as HTMLInputElement;
    await user.clear(day);
    expect(day.value).toBe("");

    // Tab away. A half-typed draft is abandoned rather than persisted, so the
    // control never misreports what is stored — the same rule the reporting-line
    // dropdown on People learned the hard way.
    await user.tab();
    expect(day.value).toBe("1");
  });

  it("still writes a number that was actually typed", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<WorkingCalendar organizationId="org" />);

    const notice = (await screen.findByLabelText("Minimum notice")) as HTMLInputElement;
    await user.clear(notice);
    await user.type(notice, "3");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(saveOrgSettings).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ defaultMinNoticeDays: 3 }),
    );
  });

  it("clears a refusal when the next edit is made", async () => {
    // The error belonged to the attempt that caused it. It was reset only at the
    // top of onSave, so "That didn't save" sat under values it had never seen.
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    saveOrgSettings.mockRejectedValueOnce(new Error("nope"));
    render(<WorkingCalendar organizationId="org" />);

    await screen.findByLabelText("Minimum notice");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/didn't save/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Minimum notice"), "7");
    expect(screen.queryByText(/didn't save/i)).not.toBeInTheDocument();
  });
});

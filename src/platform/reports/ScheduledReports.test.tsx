// @vitest-environment happy-dom

/**
 * A schedule that is wrong looks exactly like one that is right, until the
 * wrong week's email lands in the CEO's inbox.
 *
 * That is the whole reason this screen states what will arrive in a sentence,
 * and the whole reason it is worth render tests: nothing here can be checked
 * afterwards by the person who set it up. There is no "sent" list to compare
 * against — the next evidence is an email, a week later, to somebody outside the
 * company.
 *
 * What is REAL in this file and what is not matters more than usual.
 * `describeSchedule`, `describeRecipients`, `ordinal`, `ScheduleInput`,
 * `CADENCES`, `WEEKDAYS` and `MAX_RECIPIENTS` are the originals — the sentences
 * on screen are the thing under test, and stubbing them would leave this file
 * agreeing with its own fixture about what "the 31st" means. Only the four
 * functions that talk to the database are replaced.
 *
 * They are replaced for a second reason, recorded in PR #66: two earlier render
 * tests left their data layer unmocked, fired real HTTP at 127.0.0.1:54321, and
 * the 401s were swallowed by the component's own `.catch(() => {})`. They passed
 * in CI for entirely the wrong reason — a component that renders "we couldn't
 * load this" is green against an assertion about the error state.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppError } from "@/platform/errors";
import type { ReportDefinition, ReportSchedule, ScheduleInput } from "./schedules";

// ── the seam
//
// Exactly the four calls that cross the network, and nothing below them.

const listReportDefinitions = vi.fn<() => Promise<ReportDefinition[]>>();
const listSchedules = vi.fn<() => Promise<ReportSchedule[]>>();
const saveSchedule = vi.fn<(input: ScheduleInput) => Promise<string>>();
const removeSchedule = vi.fn<(id: string) => Promise<void>>();

vi.mock("./schedules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./schedules")>();
  return {
    ...actual,
    listReportDefinitions: () => listReportDefinitions(),
    listSchedules: () => listSchedules(),
    saveSchedule: (input: ScheduleInput) => saveSchedule(input),
    removeSchedule: (id: string) => removeSchedule(id),
  };
});

import { ScheduledReports } from "./ScheduledReports";

/**
 * Two definitions, ordered by title the way `listReportDefinitions` orders them.
 *
 * Two rather than one deliberately: with a single definition every dropdown has
 * one option and "the control shows what is stored" is unfalsifiable — the right
 * answer and the first option are the same element. The stored schedule below
 * therefore points at the SECOND one.
 */
const DEFINITIONS: ReportDefinition[] = [
  { key: "leave.balances", title: "Leave balances", description: "Everybody's remaining days." },
  { key: "leave.summary", title: "Leave summary", description: null },
];

/**
 * Real-shaped ids, not "sched-1".
 *
 * `ScheduleInput` requires a uuid, so a friendly made-up id passes every test
 * that never saves and then fails the first one that does — for a reason that
 * has nothing to do with the screen. The database generates these.
 */
const MONTHLY_ID = "7f6c1c14-2a9b-4d7e-8d0f-3a5c9b2e4d11";
const WEEKLY_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** Monthly, mid-month, two recipients, already sent once. */
const MONTHLY: ReportSchedule = {
  id: MONTHLY_ID,
  reportKey: "leave.summary",
  cadence: "monthly",
  dayOfWeek: null,
  dayOfMonth: 15,
  recipients: ["ceo@acme.test", "hr@acme.test"],
  isActive: true,
  lastRunOn: "2026-08-15",
};

/** Weekly, one recipient, switched off. */
const PAUSED_WEEKLY: ReportSchedule = {
  id: WEEKLY_ID,
  reportKey: "leave.balances",
  cadence: "weekly",
  dayOfWeek: 4,
  dayOfMonth: null,
  recipients: ["payroll@acme.test"],
  isActive: false,
  lastRunOn: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  listReportDefinitions.mockResolvedValue(DEFINITIONS);
  listSchedules.mockResolvedValue([MONTHLY, PAUSED_WEEKLY]);
  saveSchedule.mockResolvedValue("new-id");
  removeSchedule.mockResolvedValue(undefined);
});

/** Waits for something that exists ONLY once loaded — never the skeleton's parent. */
async function renderReady() {
  const user = userEvent.setup();
  render(<ScheduledReports />);
  await screen.findByTestId("add-schedule");
  return user;
}

/**
 * One schedule's row, found by the report title printed on it.
 *
 * The titles are distinct and appear nowhere else in a row, but the rows are
 * filtered rather than reached with `getByText(...).closest("li")` so that a
 * title which starts appearing twice fails loudly instead of silently matching
 * the first.
 */
function rowFor(title: string): HTMLElement {
  const rows = screen
    .getAllByTestId("schedule-row")
    .filter((r) => (r.textContent ?? "").includes(title));
  if (rows.length !== 1) {
    throw new Error(`expected exactly one schedule row for "${title}", found ${rows.length}`);
  }
  return rows[0];
}

const summary = () => screen.getByTestId("schedule-summary");

describe("Scheduled reports — before the data arrives", () => {
  it("shows a skeleton, and no form built out of nothing", async () => {
    // The list is held open so the loading state is a fact rather than a race.
    let release!: () => void;
    listSchedules.mockReturnValueOnce(
      new Promise<ReportSchedule[]>((resolve) => {
        release = () => resolve([MONTHLY]);
      }),
    );

    const { container } = render(<ScheduledReports />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    // Nothing that would let somebody act on data that has not arrived.
    expect(screen.queryByTestId("add-schedule")).toBeNull();
    expect(screen.queryByTestId("schedule-row")).toBeNull();

    release();

    expect(await screen.findByTestId("add-schedule")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("says the load failed rather than showing an empty panel", async () => {
    // A failed load and an empty workspace are different answers. Silence here
    // reads as "nothing is scheduled", which is the one thing an administrator
    // must not be told wrongly — they would set the same schedule up twice.
    listSchedules.mockRejectedValueOnce(new AppError("INTERNAL_ERROR", "boom", 500));

    render(<ScheduledReports />);

    expect(
      await screen.findByText(/We couldn't load your scheduled reports just now/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("add-schedule")).toBeNull();
    expect(screen.queryByText(/Nothing is scheduled/)).toBeNull();
  });
});

describe("Scheduled reports — nothing to schedule, and nothing scheduled", () => {
  it("offers no form at all when no module in this workspace can send a report", async () => {
    // The definitions list is RLS-filtered to modules this workspace has on, so
    // an empty list is ordinary — not an error. What it must not produce is a
    // form with an empty dropdown, which saves a schedule for report_key "".
    listReportDefinitions.mockResolvedValue([]);
    listSchedules.mockResolvedValue([]);

    render(<ScheduledReports />);

    expect(
      await screen.findByText(
        "None of the modules in this workspace can send a report by email yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-form")).toBeNull();
    expect(screen.queryByTestId("schedule-report")).toBeNull();
    expect(screen.queryByTestId("add-schedule")).toBeNull();
  });

  it("says nothing is scheduled, and offers the way to start one", async () => {
    listSchedules.mockResolvedValue([]);

    await renderReady();

    expect(screen.getByText(/Nothing is scheduled\./)).toBeInTheDocument();
    expect(screen.getByTestId("add-schedule")).toHaveTextContent("Schedule a report");
    expect(screen.queryAllByTestId("schedule-row")).toHaveLength(0);
  });
});

describe("Scheduled reports — what is already scheduled", () => {
  it("describes each row by its report's title and what will arrive", async () => {
    await renderReady();

    const row = rowFor("Leave summary");
    // The title, not the opaque report_key the platform passes around.
    expect(within(row).queryByText("leave.summary")).toBeNull();
    expect(row).toHaveTextContent("On the 15th of every month, covering the month just finished");
    expect(row).toHaveTextContent("To ceo@acme.test and 1 other");
    // The workspace's own date, printed as the database gave it. Re-formatting
    // through the browser's clock moves an Indian workspace's send date by a day
    // for anybody reading it from a negative UTC offset (D9).
    expect(row).toHaveTextContent("last sent 2026-08-15");
  });

  it("marks a switched-off schedule as Paused, and does not mark the live one", async () => {
    // A paused schedule sends nothing. Nothing else on the row differs, so if
    // this chip goes missing the screen shows two identical-looking schedules
    // and only one of them is real.
    await renderReady();

    expect(within(rowFor("Leave balances")).getByText("Paused")).toBeInTheDocument();
    expect(within(rowFor("Leave summary")).queryByText("Paused")).toBeNull();
  });

  it("opens an existing schedule showing what is stored, not the first option", async () => {
    // The "Reports to: Nobody" shape, on this screen. Every control below is
    // asserted by what it RENDERS as well as by its value — a <select> whose
    // value is absent from its options shows the first option instead, and
    // `select.value` alone cannot tell the two apart.
    const user = await renderReady();

    await user.click(within(rowFor("Leave summary")).getByTestId("edit-schedule"));

    const report = screen.getByTestId("schedule-report") as HTMLSelectElement;
    expect(report.value).toBe("leave.summary");
    expect(report.selectedOptions[0].textContent).toBe("Leave summary");

    const cadence = screen.getByTestId("schedule-cadence") as HTMLSelectElement;
    expect(cadence.selectedOptions[0].textContent).toBe("Every month");

    const day = screen.getByTestId("schedule-day-of-month") as HTMLSelectElement;
    expect(day.selectedOptions[0].textContent).toBe("The 15th");

    expect(screen.getByTestId("schedule-recipients")).toHaveValue("ceo@acme.test\nhr@acme.test");
    expect(screen.getByTestId("schedule-active")).toBeChecked();
    expect(summary()).toHaveTextContent(
      "On the 15th of every month, covering the month just finished, to ceo@acme.test and 1 other.",
    );
  });

  it("opens a paused schedule with the box unticked", async () => {
    // The checkbox is the difference between an email that arrives and one that
    // does not, and a form that silently re-ticks it turns "edit the address"
    // into "start sending this again".
    const user = await renderReady();

    await user.click(within(rowFor("Leave balances")).getByTestId("edit-schedule"));

    expect(screen.getByTestId("schedule-active")).not.toBeChecked();
  });
});

describe("Scheduled reports — the sentence the form promises", () => {
  it("changes what it promises as the day changes", async () => {
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));

    expect(summary()).toHaveTextContent(
      "Every Monday, covering the week just finished and the week ahead",
    );

    await user.selectOptions(screen.getByTestId("schedule-day-of-week"), "4");

    expect(summary()).toHaveTextContent(
      "Every Thursday, covering the week just finished and the week ahead",
    );
  });

  it("swaps the day control when the cadence changes", async () => {
    // A weekday left behind under a monthly cadence is a schedule the database
    // stores with a null day and which then silently never fires.
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));

    expect(screen.getByTestId("schedule-day-of-week")).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId("schedule-cadence"), "monthly");

    expect(screen.queryByTestId("schedule-day-of-week")).toBeNull();
    expect(screen.getByTestId("schedule-day-of-month")).toBeInTheDocument();
  });

  it("calls the 31st the last day of the month, because that is when it arrives", async () => {
    // THE ONE THAT WOULD MISLEAD SOMEBODY EVERY FEBRUARY. The database clamps a
    // monthly day to the length of the actual month, so a schedule set to 31
    // fires on 28 February. A screen that promises "the 31st" is promising a
    // date that does not exist in five months of the year.
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));
    await user.selectOptions(screen.getByTestId("schedule-cadence"), "monthly");

    const day = screen.getByTestId("schedule-day-of-month") as HTMLSelectElement;
    expect(day.value).toBe("31");
    expect(day.selectedOptions[0].textContent).toBe("The last day of the month");
    expect(within(day).queryByRole("option", { name: "The 31st" })).toBeNull();
    // The days that DO mean what they say still say it.
    expect(within(day).getByRole("option", { name: "The 1st" })).toBeInTheDocument();
    expect(within(day).getByRole("option", { name: "The 23rd" })).toBeInTheDocument();

    expect(summary()).toHaveTextContent("On the last day of every month, covering that month");
    expect(summary()).not.toHaveTextContent("31st");
  });

  it("counts the addresses whether they are pasted on lines or separated by commas", async () => {
    // Both are what people actually paste. The summary is the only place the
    // parse is visible before the save — two addresses that read as one means an
    // email somebody never gets.
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));

    const box = screen.getByTestId("schedule-recipients");
    expect(summary()).toHaveTextContent("to nobody.");

    await user.type(box, "ceo@acme.test{enter}hr@acme.test");
    expect(summary()).toHaveTextContent("to ceo@acme.test and 1 other.");

    await user.clear(box);
    await user.type(box, "ceo@acme.test, hr@acme.test, board@acme.test");
    expect(summary()).toHaveTextContent("to ceo@acme.test and 2 others.");
  });
});

describe("Scheduled reports — saving", () => {
  it("will not save a schedule that goes to nobody", async () => {
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));

    expect(screen.getByTestId("save-schedule")).toBeDisabled();

    await user.type(screen.getByTestId("schedule-recipients"), "ceo@acme.test");

    expect(screen.getByTestId("save-schedule")).toBeEnabled();
  });

  it("sends the day that belongs to the cadence, and confirms what will arrive", async () => {
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));
    await user.selectOptions(screen.getByTestId("schedule-cadence"), "monthly");
    await user.type(screen.getByTestId("schedule-recipients"), "ceo@acme.test");
    await user.click(screen.getByTestId("save-schedule"));

    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(1));
    expect(saveSchedule).toHaveBeenCalledWith({
      id: null,
      reportKey: "leave.balances",
      cadence: "monthly",
      // Not 1. A monthly schedule carrying a weekday is stored with both days
      // null by the database's own CASE, and then fires never.
      dayOfWeek: null,
      dayOfMonth: 31,
      recipients: ["ceo@acme.test"],
      isActive: true,
    });

    // The confirmation restates the schedule rather than saying "Saved."
    expect(await screen.findByTestId("schedules-notice")).toHaveTextContent(
      "Saved. On the last day of every month, covering that month.",
    );
    // And the list is re-read, so the new row is on screen and not just in the
    // database.
    expect(listSchedules).toHaveBeenCalledTimes(2);
  });

  it("updates the schedule it was opened from rather than creating a second one", async () => {
    // Losing the id on the way back is not a visible failure: the save
    // succeeds, the list reloads, and there are now two schedules where there
    // was one. Nobody notices until the CEO gets the same report twice.
    const user = await renderReady();
    await user.click(within(rowFor("Leave summary")).getByTestId("edit-schedule"));
    await user.click(screen.getByTestId("save-schedule"));

    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(1));
    expect(saveSchedule).toHaveBeenCalledWith({
      id: MONTHLY_ID,
      reportKey: "leave.summary",
      cadence: "monthly",
      dayOfWeek: null,
      dayOfMonth: 15,
      recipients: ["ceo@acme.test", "hr@acme.test"],
      isActive: true,
    });
  });

  it("shows the database's refusal in its own words", async () => {
    // The address the database rejects is named back at the person. The generic
    // apology below is what appears if `isAppError` stops recognising it — the
    // failure mode PR #63 shipped, where every refusal became "That didn't work."
    saveSchedule.mockRejectedValueOnce(
      new AppError("VALIDATION_FAILED", "“nope” does not look like an email address.", 400),
    );

    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));
    await user.type(screen.getByTestId("schedule-recipients"), "ceo@acme.test");
    await user.click(screen.getByTestId("save-schedule"));

    expect(await screen.findByTestId("schedules-error")).toHaveTextContent(
      "“nope” does not look like an email address.",
    );
    expect(screen.getByTestId("schedules-error")).not.toHaveTextContent(
      "That schedule couldn't be saved.",
    );
    // The form is still there with what they typed, so the refusal is something
    // they can act on rather than start again from.
    expect(screen.getByTestId("schedule-recipients")).toHaveValue("ceo@acme.test");
  });

  it("refuses an address that is not one, before the server is asked", async () => {
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));
    await user.type(screen.getByTestId("schedule-recipients"), "nope");
    await user.click(screen.getByTestId("save-schedule"));

    expect(await screen.findByTestId("schedules-error")).toHaveTextContent(
      "That does not look like an email address",
    );
    expect(saveSchedule).not.toHaveBeenCalled();
  });

  it("does not leave the refusal on screen under a corrected address", async () => {
    // The overlap-error shape: a refusal that outlived the thing it described.
    // "That does not look like an email address" sitting above an address that
    // now does is a false statement about what is in the box.
    const user = await renderReady();
    await user.click(screen.getByTestId("add-schedule"));
    await user.type(screen.getByTestId("schedule-recipients"), "nope");
    await user.click(screen.getByTestId("save-schedule"));
    await screen.findByTestId("schedules-error");

    await user.type(screen.getByTestId("schedule-recipients"), "@acme.test");

    expect(screen.queryByTestId("schedules-error")).toBeNull();
  });
});

describe("Scheduled reports — removing", () => {
  it("asks first, names who stops receiving it, and sends nothing until told", async () => {
    const user = await renderReady();

    await user.click(within(rowFor("Leave summary")).getByTestId("remove-schedule"));

    const confirm = within(rowFor("Leave summary")).getByTestId("remove-schedule-confirm");
    expect(confirm).toHaveTextContent("Stop sending this report?");
    expect(confirm).toHaveTextContent("ceo@acme.test and 1 other will stop receiving it");
    expect(removeSchedule).not.toHaveBeenCalled();

    await user.click(within(confirm).getByTestId("confirm-remove-schedule"));

    await waitFor(() => expect(removeSchedule).toHaveBeenCalledWith(MONTHLY_ID));
    expect(await screen.findByTestId("schedules-notice")).toHaveTextContent(
      "That schedule was removed. No more emails will be sent for it.",
    );
  });

  it("removes nothing if the question is answered with Cancel", async () => {
    const user = await renderReady();

    await user.click(within(rowFor("Leave summary")).getByTestId("remove-schedule"));
    await user.click(
      within(within(rowFor("Leave summary")).getByTestId("remove-schedule-confirm")).getByText(
        "Cancel",
      ),
    );

    expect(screen.queryByTestId("remove-schedule-confirm")).toBeNull();
    expect(removeSchedule).not.toHaveBeenCalled();
  });

  it("asks about the row it was opened from, not about all of them", async () => {
    // Two schedules, one question. A confirmation that renders on every row is
    // an administrator stopping the wrong report.
    const user = await renderReady();

    await user.click(within(rowFor("Leave balances")).getByTestId("remove-schedule"));

    expect(screen.getAllByTestId("remove-schedule-confirm")).toHaveLength(1);
    expect(
      within(rowFor("Leave balances")).getByTestId("remove-schedule-confirm"),
    ).toHaveTextContent("payroll@acme.test will stop receiving it");
    expect(within(rowFor("Leave summary")).queryByTestId("remove-schedule-confirm")).toBeNull();
  });
});

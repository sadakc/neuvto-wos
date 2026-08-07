/**
 * The scheduled-report handlers, with the database mocked.
 *
 * Two halves, and the second is the one that has been got wrong before.
 *
 * The pure helpers decide what the screen PROMISES — "every Monday", "the last
 * day of the month" — and a promise the database does not keep is a bug nobody
 * sees until the wrong week's email lands.
 *
 * The handler tests sit at the BOUNDARY, feeding `saveSchedule` what supabase-js
 * actually hands back rather than calling the mapper directly. That distinction
 * is not academic: `leaveErrorMessage` was tested for a year against the full
 * string, while the code path in front of it stripped everything up to the first
 * colon — so "You have 1 day available" never once reached a screen and the
 * tests were green throughout (PR #63, 7 Aug 2026).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as { message: string } | null },
  tables: {} as Record<string, { data: unknown[]; error: unknown }>,
  lastRpc: null as { name: string; args: Record<string, unknown> } | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const result = () => Promise.resolve(calls.tables[table] ?? { data: [], error: null });
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => result(),
      then: (...a: unknown[]) => result().then(...(a as [])),
    };
    return builder;
  };
  return {
    supabase: {
      from,
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.lastRpc = { name, args };
        return Promise.resolve(calls.rpc);
      },
    },
  };
});

const {
  ScheduleInput,
  describeRecipients,
  describeSchedule,
  listReportDefinitions,
  listSchedules,
  ordinal,
  removeSchedule,
  saveSchedule,
} = await import("./schedules");

beforeEach(() => {
  calls.rpc = { data: null, error: null };
  calls.tables = {};
  calls.lastRpc = null;
});

describe("ordinal", () => {
  it("gets the teens right, which the naive version does not", () => {
    // 11th, not 11st. The lookup-by-last-digit rule is wrong for exactly three
    // numbers a month has.
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
  });

  it("handles the rest", () => {
    expect([1, 2, 3, 4, 21, 22, 23, 31].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "21st",
      "22nd",
      "23rd",
      "31st",
    ]);
  });
});

describe("describeSchedule", () => {
  it("names the weekday, and says the email covers both weeks", () => {
    // Sada asked for the past week AND the upcoming week in one email. If the
    // sentence only mentioned one, the other half would look like a bug.
    expect(describeSchedule({ cadence: "weekly", dayOfWeek: 4, dayOfMonth: null })).toBe(
      "Every Thursday, covering the week just finished and the week ahead",
    );
  });

  it("maps Monday to 1 and Sunday to 7, matching the database", () => {
    // ISO, because report_schedule_fires_on compares against extract(isodow).
    // A screen numbering from Sunday would send every report a day out.
    expect(describeSchedule({ cadence: "weekly", dayOfWeek: 1, dayOfMonth: null })).toContain(
      "Every Monday",
    );
    expect(describeSchedule({ cadence: "weekly", dayOfWeek: 7, dayOfMonth: null })).toContain(
      "Every Sunday",
    );
  });

  it("does NOT say “the 31st”, because February has no 31st", () => {
    // The database clamps the day to the length of the month, so a schedule set
    // to 31 fires on 28 February. A screen that said "on the 31st of every
    // month" would be describing something that happens seven times a year.
    const said = describeSchedule({ cadence: "monthly", dayOfWeek: null, dayOfMonth: 31 });
    expect(said).toBe("On the last day of every month, covering that month");
    expect(said).not.toContain("31st");
  });

  it("names an ordinary day of the month plainly", () => {
    expect(describeSchedule({ cadence: "monthly", dayOfWeek: null, dayOfMonth: 3 })).toBe(
      "On the 3rd of every month, covering the month just finished",
    );
  });
});

describe("describeRecipients", () => {
  it("counts the others, and gets the singular right", () => {
    expect(describeRecipients([])).toBe("nobody");
    expect(describeRecipients(["ceo@acme.com"])).toBe("ceo@acme.com");
    expect(describeRecipients(["ceo@acme.com", "hr@acme.com"])).toBe("ceo@acme.com and 1 other");
    expect(describeRecipients(["a@x.com", "b@x.com", "c@x.com"])).toBe("a@x.com and 2 others");
  });
});

describe("ScheduleInput", () => {
  const base = {
    id: null,
    reportKey: "leave.summary",
    recipients: ["ceo@acme.com"],
    isActive: true,
  };

  it("refuses a weekly schedule with no weekday", () => {
    // The database stores day_of_week as null for a monthly schedule, so a
    // weekly one that arrived without a day would be saved and would then match
    // no day at all — a row that looks configured and never fires.
    expect(() =>
      ScheduleInput.parse({ ...base, cadence: "weekly", dayOfWeek: null, dayOfMonth: null }),
    ).toThrow(/day of the week/i);
  });

  it("refuses a monthly schedule with no day of the month", () => {
    expect(() =>
      ScheduleInput.parse({ ...base, cadence: "monthly", dayOfWeek: null, dayOfMonth: null }),
    ).toThrow(/day of the month/i);
  });

  it("refuses an address that is not one, before the round trip", () => {
    expect(() =>
      ScheduleInput.parse({ ...base, cadence: "weekly", dayOfWeek: 1, recipients: ["nope"] }),
    ).toThrow(/email address/i);
  });

  it("refuses an empty recipient list", () => {
    expect(() =>
      ScheduleInput.parse({ ...base, cadence: "weekly", dayOfWeek: 1, recipients: [] }),
    ).toThrow(/at least one/i);
  });

  it("accepts a valid weekly schedule", () => {
    const parsed = ScheduleInput.parse({ ...base, cadence: "weekly", dayOfWeek: 5 });
    expect(parsed.dayOfWeek).toBe(5);
    expect(parsed.dayOfMonth).toBeNull();
  });
});

describe("saveSchedule", () => {
  it("omits the optional arguments rather than sending null", async () => {
    // They carry DEFAULT NULL in SQL. Sending an explicit null works today and
    // is what the generated types refuse — the two disagreeing about "absent"
    // is how an optional argument silently becomes required.
    calls.rpc = { data: "sched-1", error: null };
    await saveSchedule(
      ScheduleInput.parse({
        id: null,
        reportKey: "leave.summary",
        cadence: "weekly",
        dayOfWeek: 2,
        recipients: ["ceo@acme.com"],
        isActive: true,
      }),
    );
    expect(calls.lastRpc?.name).toBe("report_schedule_save");
    expect(calls.lastRpc?.args._id).toBeUndefined();
    expect(calls.lastRpc?.args._day_of_month).toBeUndefined();
    expect(calls.lastRpc?.args._day_of_week).toBe(2);
  });

  it("names the address the database rejected", async () => {
    // AT THE BOUNDARY, with the shape supabase-js returns. A mapper tested on
    // its own passes while the caller in front of it destroys the payload.
    calls.rpc = { data: null, error: { message: "BAD_EMAIL: ceo@acme" } };
    await expect(
      saveSchedule(
        ScheduleInput.parse({
          id: null,
          reportKey: "leave.summary",
          cadence: "weekly",
          dayOfWeek: 1,
          recipients: ["ceo@acme.com"],
          isActive: true,
        }),
      ),
    ).rejects.toThrow(/ceo@acme/);
  });

  it("survives the ERROR: prefix Postgres sometimes carries", async () => {
    calls.rpc = { data: null, error: { message: "ERROR:  BAD_EMAIL: someone@" } };
    await expect(
      saveSchedule(
        ScheduleInput.parse({
          id: null,
          reportKey: "leave.summary",
          cadence: "weekly",
          dayOfWeek: 1,
          recipients: ["ceo@acme.com"],
          isActive: true,
        }),
      ),
    ).rejects.toThrow(/someone@/);
  });

  it("explains a report whose module was switched off mid-edit", async () => {
    calls.rpc = { data: null, error: { message: "REPORT_NOT_FOUND" } };
    await expect(
      saveSchedule(
        ScheduleInput.parse({
          id: null,
          reportKey: "leave.summary",
          cadence: "weekly",
          dayOfWeek: 1,
          recipients: ["ceo@acme.com"],
          isActive: true,
        }),
      ),
    ).rejects.toThrow(/no longer available/i);
  });
});

describe("removeSchedule", () => {
  it("explains a schedule somebody else already removed", async () => {
    calls.rpc = { data: null, error: { message: "SCHEDULE_NOT_FOUND" } };
    await expect(removeSchedule("gone")).rejects.toThrow(/no longer exists/i);
  });

  it("says who may change it when the database refuses", async () => {
    calls.rpc = { data: null, error: { message: "FORBIDDEN" } };
    await expect(removeSchedule("x")).rejects.toThrow(/administrator/i);
  });
});

describe("listSchedules", () => {
  it("reads the rows into the shape the screen uses", async () => {
    calls.tables.report_schedules = {
      data: [
        {
          id: "s1",
          report_key: "leave.summary",
          cadence: "monthly",
          day_of_week: null,
          day_of_month: 31,
          recipients: ["ceo@acme.com"],
          is_active: true,
          last_run_on: "2026-07-31",
        },
      ],
      error: null,
    };
    const [s] = await listSchedules();
    expect(s).toEqual({
      id: "s1",
      reportKey: "leave.summary",
      cadence: "monthly",
      dayOfWeek: null,
      dayOfMonth: 31,
      recipients: ["ceo@acme.com"],
      isActive: true,
      lastRunOn: "2026-07-31",
    });
  });

  it("gives an empty array rather than undefined when a row has no recipients", async () => {
    // The row renders `describeRecipients(s.recipients)`, and `undefined.length`
    // is a blank panel rather than a schedule with a problem.
    calls.tables.report_schedules = {
      data: [
        {
          id: "s1",
          report_key: "leave.summary",
          cadence: "weekly",
          day_of_week: 1,
          day_of_month: null,
          recipients: null,
          is_active: true,
          last_run_on: null,
        },
      ],
      error: null,
    };
    expect((await listSchedules())[0].recipients).toEqual([]);
  });

  it("throws rather than returning an empty list when the read fails", async () => {
    // An empty list means "nothing is scheduled" and the screen says so. A
    // failed read must not be mistaken for it.
    calls.tables.report_schedules = { data: [], error: { message: "boom" } };
    await expect(listSchedules()).rejects.toThrow();
  });
});

describe("listReportDefinitions", () => {
  it("throws rather than returning an empty list when the read fails", async () => {
    // Same reason, sharper consequence: an empty list makes the screen say the
    // workspace has no reports that can be emailed, which is a statement about
    // the customer's configuration and not about a network error.
    calls.tables.report_definitions = { data: [], error: { message: "boom" } };
    await expect(listReportDefinitions()).rejects.toThrow();
  });
});

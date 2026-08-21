/**
 * What the whole organisation shares.
 *
 * The test for whether something belongs here is not "is it important" but "is
 * it still true when a module is switched off". A department survives Leave
 * being turned off and Payroll being turned on; a leave type does not. So the
 * roster's grouping, the working week, the holidays and the module switches
 * live here, and everything a module invented lives in that module's own page.
 *
 * The working calendar is the case that decides the rule. Payroll's pay
 * schedule wants a working week; so does Leave; so will Attendance. Giving each
 * of them their own would be a workspace with three weekends, and the one that
 * pays people would eventually disagree with the one that counts their days
 * off. It is asked once, here.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { addHoliday, listHolidays, removeHoliday, type Holiday } from "@/platform/calendar";
import { OrgModules } from "@/platform/modules";
import { AdminGate } from "@/components/shared/admin-gate";
import { CompanyIdentity } from "@/platform/organization/CompanyIdentity";
import { Departments } from "@/platform/organization/Departments";
import { WorkingCalendar } from "@/platform/calendar/WorkingCalendar";

export const Route = createFileRoute("/app/configurations/")({
  component: () => <AdminGate>{(user) => <OrganisationSettings user={user} />}</AdminGate>,
});

function OrganisationSettings({ user }: { user: CurrentUser }) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [error, setError] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Allowed to fail quietly. Everything above the holiday list is still
    // editable if this one read does not come back.
    listHolidays()
      .then((h) => !cancelled && setHolidays(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function onAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!holidayName.trim() || !holidayDate) return;
    setError("");
    try {
      await addHoliday(user.organizationId, holidayName.trim(), holidayDate);
      setHolidays(await listHolidays());
      setHolidayName("");
      setHolidayDate("");
    } catch (e) {
      setError(isAppError(e) ? e.message : "That holiday couldn't be added.");
    }
  }

  async function onRemoveHoliday(id: string) {
    setError("");
    try {
      await removeHoliday(id);
      setHolidays(await listHolidays());
    } catch (e) {
      setError(isAppError(e) ? e.message : "That holiday couldn't be removed.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="font-display text-xl font-semibold tracking-tight">Organisation</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Configuration every module shares. Changing the working week or the financial year changes
        how every future request is counted, and how every future month is paid. Anything belonging
        to one module is configured from that module.
      </p>

      {/* ─────────────────────────────────────────────── company */}
      <section className="mt-8">
        <h2 className="font-display text-base font-semibold">Your company</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What this workspace is called, and the mark your people see on every screen and in every
          email from it.
        </p>
        <div className="mt-4">
          <CompanyIdentity />
        </div>
      </section>

      {/* ───────────────────────────────────────── the working calendar
          Shared with the setup wizard. It lived in full on the old configurations page
          until the wizard needed the same weekend picker, and a weekend whose
          rules exist in two files is a weekend that eventually means two things
          — with every balance in the product counted against it, and now every
          pay date resolved against it too. */}
      <section className="mt-10">
        <h2 className="font-display text-base font-semibold">Working calendar</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          The working week and the financial year, used by every module. Leave is counted against it
          and salary is credited against it. Leave already booked is not recalculated.
        </p>
        <div className="mt-4">
          <WorkingCalendar organizationId={user.organizationId} />
        </div>
      </section>

      {/* ─────────────────────────────────────────────── departments
          The example Sada named. Above Holidays because it is the one people go
          looking for: the Department column exists on every report, leave and
          payroll alike, and until it existed nothing in the product could put
          anybody in one. */}
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold tracking-tight">Departments</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          How your workforce is grouped, on a leave report and a salary register alike.
          Somebody&apos;s department is set on their row under People, or from the department column
          of a spreadsheet import.
        </p>
        <div className="mt-4">
          <Departments organizationId={user.organizationId} />
        </div>
      </section>

      {/* ─────────────────────────────────────────────── holidays */}
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold tracking-tight">Holidays</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Days excluded from leave when a request spans them, and days a salary is not credited on.
          Shared with attendance and shift planning when those arrive.
        </p>

        <form onSubmit={onAddHoliday} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            aria-label="Holiday name"
            value={holidayName}
            onChange={(e) => setHolidayName(e.target.value)}
            placeholder="Republic Day"
            className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <input
            aria-label="Holiday date"
            type="date"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
            className="h-12 rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            type="submit"
            disabled={!holidayName.trim() || !holidayDate}
            data-testid="add-holiday"
            className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {/* Set by both handlers above and, until it was caught by lint, rendered
            nowhere — so a holiday that failed to save failed in silence and the
            row simply did not appear. */}
        {error && (
          <p role="alert" data-testid="holidays-error" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {holidays.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            No holidays configured yet. Until some are added, only non-working days are excluded.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4 p-4">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.name}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {new Date(h.holidayDate + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </span>
                <button
                  onClick={() => onRemoveHoliday(h.id)}
                  className="inline-flex h-12 shrink-0 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─────────────────────────────────────────────── modules
          Last, because it is the one section that decides whether the others
          have neighbours. Switching a module on here is what makes its own
          configurations page reachable from the switcher. */}
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold tracking-tight">Modules</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What this workspace has, and what is switched on. Neuvto adds modules to your workspace;
          switching them on and off is yours. Each one is configured from its own page — use the
          menu at the top left.
        </p>
        <div className="mt-4">
          <OrgModules user={user} />
        </div>
      </section>
    </div>
  );
}

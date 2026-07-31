import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { getCurrentUser, isAdmin, type CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { addHoliday, listHolidays, removeHoliday, type Holiday } from "@/platform/calendar";
import { getAdminSections, OrgModules, type ModuleAdminSection } from "@/platform/modules";
import { CompanyIdentity } from "@/platform/organization/CompanyIdentity";
import { WorkingCalendar } from "@/platform/calendar/WorkingCalendar";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Settings — Neuvto WOS" }] }),
  component: SettingsPage,
});

/**
 * Configuration, not code.
 *
 * This page was read-only and said so: "editing arrives with the admin screens."
 * It was the first place Sada looked for leave configuration and the reason he
 * could not set his workspace up. Everything here is now editable, and the
 * blocks each module contributes are rendered underneath — so configuring leave
 * lives inside the Leave module while this file still names no module at all.
 */
function SettingsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [sections, setSections] = useState<(ModuleAdminSection & { moduleKey: string })[]>([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const u = await getCurrentUser();
        if (cancelled) return;
        setUser(u);

        if (!isAdmin(u)) {
          setState("denied");
          return;
        }

        // None of these are worth blanking the page for — the settings above
        // are still editable if the holiday list or the module sections fail.
        const [h, sec] = await Promise.allSettled([listHolidays(), getAdminSections(u)]);
        if (!cancelled) {
          if (h.status === "fulfilled") setHolidays(h.value);
          if (sec.status === "fulfilled") setSections(sec.value);
        }

        setState("ready");
      } catch (e) {
        if (cancelled) return;
        console.error("settings load failed", e);
        setMessage("We couldn't load your settings.");
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !holidayName.trim() || !holidayDate) return;
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

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace settings are managed by your administrator.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="font-display text-xl font-semibold tracking-tight">Workspace settings</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Configuration your organisation owns. Changing the working week or the financial year
        changes how every future request is counted.
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
          Shared with the setup wizard. It lived here in full until the wizard
          needed the same weekend picker, and a weekend whose rules exist in two
          files is a weekend that eventually means two things — with every
          balance in the product counted against it. */}
      <section className="mt-10">
        <h2 className="font-display text-base font-semibold">Working calendar</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Changing the working week or the financial year changes how every future request is
          counted. Leave already booked is not recalculated.
        </p>
        <div className="mt-4">
          {user && <WorkingCalendar organizationId={user.organizationId} />}
        </div>
      </section>

      {/* ─────────────────────────────────────────────── holidays */}
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold tracking-tight">Holidays</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Days excluded from leave when a request spans them. Shared with attendance and shift
          planning when those arrive.
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

      {/* ─────────────────────────────────────────────── modules */}
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold tracking-tight">Modules</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What this workspace has, and what is switched on. Neuvto adds modules to your workspace;
          switching them on and off is yours.
        </p>
        <div className="mt-4">
          <OrgModules user={user} />
        </div>
      </section>

      {/*
        Whatever the enabled modules contribute. This file names none of them —
        the same rule app-nav.tsx and the dashboard follow, and the reason
        "configure leave types" can live inside src/modules/leave where every
        other leave decision does.
      */}
      {sections.map((section) => {
        const Section = section.component;
        return (
          <section key={`${section.moduleKey}:${section.id}`} className="mt-12">
            <h2 className="font-display text-lg font-semibold tracking-tight">{section.title}</h2>
            {section.description && (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {section.description}
              </p>
            )}
            <div className="mt-4">
              <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
                <Section />
              </Suspense>
            </div>
          </section>
        );
      })}
    </div>
  );
}

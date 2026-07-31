import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { getCurrentUser, isAdmin, type CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import {
  addHoliday,
  getOrgSettings,
  listHolidays,
  removeHoliday,
  saveOrgSettings,
  getFinancialYear,
  type Holiday,
  type OrgSettings,
} from "@/platform/calendar";
import { getAdminSections, OrgModules, type ModuleAdminSection } from "@/platform/modules";
import { CompanyIdentity } from "@/platform/organization/CompanyIdentity";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Settings — Neuvto WOS" }] }),
  component: SettingsPage,
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [financialYear, setFinancialYear] = useState("");
  const [sections, setSections] = useState<(ModuleAdminSection & { moduleKey: string })[]>([]);

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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

        const s = await getOrgSettings();
        if (cancelled) return;
        if (!s) {
          setMessage("No configuration found for this workspace.");
          setState("error");
          return;
        }
        setSettings(s);

        // None of these are worth blanking the page for — the settings above
        // are still editable if the holiday list or the module sections fail.
        const [h, fy, sec] = await Promise.allSettled([
          listHolidays(),
          u ? getFinancialYear(u.organizationId) : Promise.resolve(""),
          getAdminSections(u),
        ]);
        if (!cancelled) {
          if (h.status === "fulfilled") setHolidays(h.value);
          if (fy.status === "fulfilled") setFinancialYear(fy.value);
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

  function update<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  function toggleWeekendDay(day: number) {
    if (!settings) return;
    const next = settings.weekendDays.includes(day)
      ? settings.weekendDays.filter((d) => d !== day)
      : [...settings.weekendDays, day].sort((a, b) => a - b);
    update("weekendDays", next);
  }

  async function onSave() {
    if (!settings || !user) return;
    setError("");
    setSaving(true);
    try {
      await saveOrgSettings(user.organizationId, settings);
      setSaved(true);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

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

  const s = settings!;
  const workingDays = DAYS.filter((_, i) => !s.weekendDays.includes(i)).length;

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

      {/* ─────────────────────────────────────────────── the working week */}
      <section className="mt-8">
        <h2 className="font-display text-base font-semibold">The working week</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Which days are <strong>not</strong> worked. A six-day week has only Sunday selected; a
          five-day week has Saturday and Sunday.
        </p>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Non-working days">
          {DAYS.map((d, i) => {
            const off = s.weekendDays.includes(i);
            return (
              <button
                key={d}
                onClick={() => toggleWeekendDay(i)}
                aria-pressed={off}
                data-testid={`weekend-${i}`}
                className={`inline-flex h-12 items-center rounded-md border px-3 text-sm ${
                  off
                    ? "border-foreground bg-secondary font-medium"
                    : "border-border text-muted-foreground"
                }`}
              >
                {d.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {workingDays === 0
            ? "A working week needs at least one working day."
            : `${workingDays}-day working week`}
        </p>

        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.excludeWeekends}
            onChange={(e) => update("excludeWeekends", e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">
              Don&apos;t count non-working days as leave
            </span>
            <span className="block text-xs text-muted-foreground">
              Friday to Monday costs 2 days rather than 4
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.excludeHolidays}
            onChange={(e) => update("excludeHolidays", e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">Don&apos;t count holidays as leave</span>
            <span className="block text-xs text-muted-foreground">
              A request spanning a holiday below doesn&apos;t spend a day on it
            </span>
          </span>
        </label>
      </section>

      {/* ─────────────────────────────────────────────── the year */}
      <section className="mt-10">
        <h2 className="font-display text-base font-semibold">The leave year</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fy-month" className="block text-sm font-medium">
              Financial year starts
            </label>
            <div className="mt-2 flex gap-2">
              <select
                id="fy-month"
                value={s.fyStartMonth}
                onChange={(e) => update("fyStartMonth", Number(e.target.value))}
                className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                aria-label="Day of month"
                type="number"
                min={1}
                max={31}
                value={s.fyStartDay}
                onChange={(e) => update("fyStartDay", Number(e.target.value))}
                className="h-12 w-20 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Drives entitlement and the annual reset
              {financialYear && ` · currently ${financialYear}`}
            </p>
          </div>

          {/* D34, in the customer's hands. */}
          <div>
            <label htmlFor="fy-open" className="block text-sm font-medium">
              Next year opens
            </label>
            <select
              id="fy-open"
              value={s.nextFyOpensMonthsBefore}
              onChange={(e) => update("nextFyOpensMonthsBefore", Number(e.target.value))}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value={0}>Not until it starts</option>
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m} month{m === 1 ? "" : "s"} before
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              How early people can book into next year
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── requests */}
      <section className="mt-10">
        <h2 className="font-display text-base font-semibold">Requests</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="notice" className="block text-sm font-medium">
              Minimum notice
            </label>
            <input
              id="notice"
              type="number"
              min={0}
              max={365}
              value={s.defaultMinNoticeDays}
              onChange={(e) => update("defaultMinNoticeDays", Number(e.target.value))}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Days. A leave type can require more
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium">Time zone</span>
            <p className="mt-2 flex h-12 items-center text-sm tabular-nums">{s.timezone}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every date check resolves here, never against the server clock
            </p>
          </div>
        </div>

        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.allowRetroactive}
            onChange={(e) => update("allowRetroactive", e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">Allow backdated requests</span>
            <span className="block text-xs text-muted-foreground">
              Lets somebody record leave they have already taken
            </span>
          </span>
        </label>
      </section>

      {error && (
        <p role="alert" data-testid="settings-error" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={onSave}
          disabled={saving || workingDays === 0}
          data-testid="save-settings"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>

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

/**
 * Configuration · Calendars and shifts (D102).
 *
 * A calendar is the days of the week that are off; a unit names one, and a
 * person's leave is counted on the calendar of the unit they are posted to on
 * each day. The Company calendar is the one Settings sets, used by every unit
 * that names none; it is listed here and edited there. A new calendar starts
 * with Sunday off.
 *
 * A shift is a start, an end (earlier than the start for a night shift) and an
 * unpaid break. A unit has a default; a person may have their own, set on
 * their card. Nothing in use is retired.
 */

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { isAppError } from "@/platform/errors";
import type { CalendarRow, ShiftRow } from "../contracts";
import { describeShift, describeWeek } from "../format";
import {
  listCalendars,
  listShifts,
  saveCalendar,
  saveShift,
  setCalendarStatus,
  setShiftStatus,
} from "../handlers";
import { Panel } from "./parts";

const input = "mt-1 h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
/** Monday first, as people read a week; the numbers are the database's (0 = Sunday). */
const WEEK: [number, string][] = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [0, "Sunday"],
];
const errorText = (e: unknown, fallback: string) => (isAppError(e) ? e.message : fallback);

export function CalendarsAndShifts() {
  const [calendars, setCalendars] = useState<CalendarRow[] | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [error, setError] = useState("");
  const [editingCal, setEditingCal] = useState<CalendarRow | "new" | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftRow | "new" | null>(null);

  async function load() {
    try {
      const [c, s] = await Promise.all([listCalendars(), listShifts()]);
      setCalendars(c);
      setShifts(s);
    } catch (e) {
      setError(errorText(e, "Calendars and shifts didn't load."));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e, "That couldn't be changed."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Panel
        title="Working calendars"
        aside={
          <button
            type="button"
            onClick={() => setEditingCal("new")}
            className="text-sm font-medium text-primary hover:underline"
          >
            Add a calendar
          </button>
        }
        footer="A unit names its calendar in Deployment units. Leave is counted on the calendar of the unit a person is posted to on each day; leave already asked for keeps the days it was counted at."
      >
        {editingCal && (
          <CalendarForm
            calendar={editingCal === "new" ? null : editingCal}
            onCancel={() => setEditingCal(null)}
            onSaved={async () => {
              setEditingCal(null);
              await load();
            }}
          />
        )}
        {calendars === null ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : (
          <ul className="divide-y divide-border">
            {calendars.map((c) => (
              <li
                key={c.id}
                data-testid="calendar-row"
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-caption text-muted-foreground">
                    {describeWeek(c.weeklyOff)} · {c.units} {c.units === 1 ? "unit" : "units"}
                  </span>
                </span>
                {c.isDefault ? (
                  <span className="text-caption text-muted-foreground">Set on Settings</span>
                ) : (
                  <>
                    {c.status === "retired" && <StatusBadge tone="neutral">Retired</StatusBadge>}
                    {c.status === "active" && (
                      <button
                        type="button"
                        onClick={() => setEditingCal(c)}
                        className="text-sm text-primary hover:underline"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={c.status === "active" && c.units > 0}
                      title={
                        c.status === "active" && c.units > 0
                          ? "A unit uses it. Give the unit another calendar first."
                          : undefined
                      }
                      onClick={() =>
                        void toggle(() =>
                          setCalendarStatus(c.id, c.status === "active" ? "retired" : "active"),
                        )
                      }
                      className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                    >
                      {c.status === "active" ? "Retire" : "Bring back"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Shifts"
        aside={
          <button
            type="button"
            onClick={() => setEditingShift("new")}
            className="text-sm font-medium text-primary hover:underline"
          >
            Add a shift
          </button>
        }
        footer="A unit's default shift is set in Deployment units; a person's own shift on their card. Rosters, swaps, grace and overtime arrive with Attendance."
      >
        {editingShift && (
          <ShiftForm
            shift={editingShift === "new" ? null : editingShift}
            onCancel={() => setEditingShift(null)}
            onSaved={async () => {
              setEditingShift(null);
              await load();
            }}
          />
        )}
        {shifts === null ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shifts.map((s) => {
              const inUse = s.units + s.people > 0;
              return (
                <li
                  key={s.id}
                  data-testid="shift-row"
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.name}</span>
                    <span className="block text-caption text-muted-foreground">
                      {describeShift(s)} · {s.units} {s.units === 1 ? "unit" : "units"}, {s.people}{" "}
                      {s.people === 1 ? "person" : "people"} on it as their own
                    </span>
                  </span>
                  {s.status === "retired" && <StatusBadge tone="neutral">Retired</StatusBadge>}
                  {s.status === "active" && (
                    <button
                      type="button"
                      onClick={() => setEditingShift(s)}
                      className="text-sm text-primary hover:underline"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={s.status === "active" && inUse}
                    title={
                      s.status === "active" && inUse
                        ? "A unit or a person uses it. Change those first."
                        : undefined
                    }
                    onClick={() =>
                      void toggle(() =>
                        setShiftStatus(s.id, s.status === "active" ? "retired" : "active"),
                      )
                    }
                    className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                  >
                    {s.status === "active" ? "Retire" : "Bring back"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CalendarForm({
  calendar,
  onCancel,
  onSaved,
}: {
  calendar: CalendarRow | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(calendar?.name ?? "");
  const [off, setOff] = useState<number[]>(calendar?.weeklyOff ?? [0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = name.trim() !== "" && off.length < 7;

  return (
    <form
      data-testid="calendar-form"
      className="mb-3 grid gap-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        saveCalendar(calendar?.id ?? null, {
          name: name.trim(),
          weeklyOff: [...off].sort((a, b) => a - b),
        })
          .then(onSaved)
          .catch((err) => setError(errorText(err, "The calendar couldn't be saved.")))
          .finally(() => setBusy(false));
      }}
    >
      <label className="text-sm font-medium">
        Name
        <input
          aria-label="Name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={input}
        />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Days off</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
          {WEEK.map(([d, label]) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                aria-label={label}
                checked={off.includes(d)}
                onChange={(e) =>
                  setOff(e.target.checked ? [...off, d] : off.filter((x) => x !== d))
                }
                className="size-4"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          {off.length === 7 ? "A week needs at least one working day." : describeWeek(off)}
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !valid}
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          Save calendar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ShiftForm({
  shift,
  onCancel,
  onSaved,
}: {
  shift: ShiftRow | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(shift?.name ?? "");
  const [start, setStart] = useState(shift?.startTime ?? "");
  const [end, setEnd] = useState(shift?.endTime ?? "");
  const [brk, setBrk] = useState(String(shift?.breakMinutes ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const breakOk = /^\d{1,3}$/.test(brk) && Number(brk) <= 240;
  const valid = name.trim() !== "" && !!start && !!end && start !== end && breakOk;

  return (
    <form
      data-testid="shift-form"
      className="mb-3 grid gap-3 rounded-lg border border-border p-3 @min-[640px]/app:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        saveShift(shift?.id ?? null, {
          name: name.trim(),
          startTime: start,
          endTime: end,
          breakMinutes: Number(brk),
        })
          .then(onSaved)
          .catch((err) => setError(errorText(err, "The shift couldn't be saved.")))
          .finally(() => setBusy(false));
      }}
    >
      <label className="text-sm font-medium">
        Name
        <input
          aria-label="Name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={input}
        />
      </label>
      <label className="text-sm font-medium">
        Starts
        <input
          type="time"
          aria-label="Starts"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className={input}
        />
      </label>
      <label className="text-sm font-medium">
        Ends
        <input
          type="time"
          aria-label="Ends"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className={input}
        />
      </label>
      <label className="text-sm font-medium">
        Unpaid break (minutes)
        <input
          aria-label="Unpaid break (minutes)"
          inputMode="numeric"
          value={brk}
          onChange={(e) => setBrk(e.target.value)}
          className={input}
        />
      </label>
      <p className="text-caption text-muted-foreground @min-[640px]/app:col-span-4">
        {start && end && start !== end
          ? describeShift({ startTime: start, endTime: end, breakMinutes: Number(brk) || 0 })
          : "An end earlier than the start is a night shift, ending the next morning."}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive @min-[640px]/app:col-span-4">
          {error}
        </p>
      )}
      <div className="flex gap-2 @min-[640px]/app:col-span-4">
        <button
          type="submit"
          disabled={busy || !valid}
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          Save shift
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

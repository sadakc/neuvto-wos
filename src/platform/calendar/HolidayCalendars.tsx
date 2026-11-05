/**
 * Which calendars a holiday applies to (D102).
 *
 * One company holiday list; a holiday applies to every calendar unless it is
 * limited to some, say a state holiday for one state's units. A company with
 * only its Company calendar has nothing to choose, so nothing is offered.
 */

import { useState } from "react";
import { isAppError } from "@/platform/errors";
import { setHolidayCalendars, type CalendarOption, type Holiday } from ".";

/** "All calendars", or "Bengaluru sites only", "A and B only". */
function holidayAppliesTo(h: Holiday, calendars: CalendarOption[]): string {
  const names = calendars.filter((c) => h.calendarIds.includes(c.id)).map((c) => c.name);
  if (h.calendarIds.length === 0 || names.length === 0) return "All calendars";
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} only`;
}

export function HolidayCalendars({
  holiday,
  calendars,
  onSaved,
}: {
  holiday: Holiday;
  calendars: CalendarOption[];
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>(holiday.calendarIds);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="text-xs text-muted-foreground">
      <span>{holidayAppliesTo(holiday, calendars)}</span>
      {calendars.length > 1 && !editing && (
        <button
          type="button"
          onClick={() => {
            setPicked(holiday.calendarIds);
            setError("");
            setEditing(true);
          }}
          className="ml-2 underline underline-offset-4"
        >
          Applies to
        </button>
      )}
      {editing && (
        <form
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setHolidayCalendars(holiday.id, picked)
              .then(async () => {
                setEditing(false);
                await onSaved();
              })
              .catch((err) => setError(isAppError(err) ? err.message : "That couldn't be saved."))
              .finally(() => setBusy(false));
          }}
        >
          {calendars.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                aria-label={c.name}
                checked={picked.includes(c.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))
                }
                className="size-4"
              />
              {c.name}
            </label>
          ))}
          <span className="w-full">None ticked: every calendar.</span>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm text-foreground"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-sm underline underline-offset-4"
          >
            Cancel
          </button>
          {error && (
            <span role="alert" className="w-full text-sm text-destructive">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

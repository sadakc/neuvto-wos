/**
 * The Employment tab's "Shift and calendar" (D102).
 *
 * Which calendar a person's leave is counted on today and which shift they
 * work, and where each comes from: their unit, the Company calendar, or their
 * own shift. Everybody in the company sees it; the own-shift history is drawn
 * only where the card carried it (the person, the Employee Admin and their
 * manager). Only an Admin is offered Change shift.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isAppError } from "@/platform/errors";
import type { EmployeeCard, ShiftRow } from "../contracts";
import { describeShift, describeWeek, formatDate, lastDay, todayIso } from "../format";
import { listShifts, setShift } from "../handlers";
import { Fields, Panel, RecordTable } from "./parts";

const input = "mt-1 h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

export function ShiftCalendarPanel({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const w = card.workPattern;
  if (!w) return null;
  const shiftFrom =
    w.shiftSource === "person"
      ? `Their own shift since ${formatDate(w.ownShiftSince)}`
      : w.shiftSource === "unit"
        ? `From ${w.unitName}`
        : null;
  return (
    <Panel
      title="Shift and calendar"
      testId="panel-shift-calendar"
      aside={
        card.capabilities.canSetShift ? <ShiftDialog card={card} onChanged={onChanged} /> : null
      }
      footer="Leave is counted on the calendar of the unit somebody is posted to on each day, so a move to a six-day site changes it from the move."
    >
      <Fields
        items={[
          { label: "Working calendar", value: w.calendar.name },
          { label: "Days off", value: describeWeek(w.calendar.weeklyOff) },
          {
            label: "Calendar from",
            value: w.calendarSource === "unit" ? `From ${w.unitName}` : "The Company calendar",
          },
          {
            label: "Shift",
            value: w.shift ? `${w.shift.name}, ${describeShift(w.shift)}` : "No shift set",
          },
          ...(shiftFrom ? [{ label: "Shift from", value: shiftFrom }] : []),
        ]}
      />
      {w.ownShifts && w.ownShifts.length > 0 && (
        <div className="mt-3" data-testid="own-shift-history">
          <p className="mb-1 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
            Their own shifts
          </p>
          <RecordTable
            headers={["Shift", "From", "To", "Reason", "Set by"]}
            empty="None."
            rows={w.ownShifts.map((o) => ({
              key: o.id,
              muted: o.effectiveTo !== null,
              cells: [
                `${o.shiftName}, ${describeShift({ ...o, breakMinutes: 0 })}`,
                formatDate(o.effectiveFrom),
                o.effectiveTo ? formatDate(lastDay(o.effectiveTo)) : "Current",
                o.reason ?? "—",
                o.setBy ?? "—",
              ],
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

/** Gives a person their own shift from a date, or returns them to their unit's. */
function ShiftDialog({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [shiftId, setShiftId] = useState("");
  const [from, setFrom] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    if (!open) return;
    listShifts()
      .then((s) => setShifts(s.filter((x) => x.status === "active")))
      .catch(() => setShifts([]));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDateError("");
    try {
      await setShift(card.id, { shiftId: shiftId || null, effectiveFrom: from, reason });
      setOpen(false);
      await onChanged();
    } catch (err) {
      const msg = isAppError(err) ? err.message : "The shift couldn't be saved.";
      if (isAppError(err) && String(err.details?.code ?? "").includes("EFFECTIVE_DATE_CLASH")) {
        setDateError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShiftId("");
          setFrom(todayIso());
          setReason("");
          setError("");
          setDateError("");
          setOpen(true);
        }}
        className="text-sm font-medium text-primary hover:underline"
      >
        Change shift
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Change shift</DialogTitle>
            <DialogDescription>
              {card.workPattern?.shiftSource === "person"
                ? `Their own shift since ${formatDate(card.workPattern.ownShiftSince)} ends the day before this starts. It stays on the record.`
                : "From this date they work this shift instead of their unit's."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-3">
            <label className="text-sm font-medium">
              Shift
              <select
                aria-label="Shift"
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
                className={input}
              >
                <option value="">Their unit&apos;s shift</option>
                {(shifts ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}, {describeShift(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              From
              <input
                type="date"
                aria-label="From"
                required
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setDateError("");
                }}
                className={input}
              />
              {dateError && (
                <span role="alert" className="mt-1 block text-sm font-normal text-destructive">
                  {dateError}
                </span>
              )}
            </label>
            <label className="text-sm font-medium">
              Reason (optional)
              <input
                aria-label="Reason (optional)"
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={input}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !from}
              className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              {busy ? "Saving…" : "Save shift"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

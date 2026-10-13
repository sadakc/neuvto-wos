/**
 * A date, the way HR systems such as Workday take one (D104): typed as
 * DD/MM/YYYY, or picked from a calendar whose month and year are dropdowns, so
 * a date of birth in 1990 is two choices rather than four hundred clicks back.
 *
 * The value is an ISO date ("1990-05-01") or "" for none. While what is typed
 * is not yet a whole, real date, the value is the typed text itself, so a form
 * can never mistake half a date for no date: `isIsoDate` tells the two apart,
 * and the form says "Enter the date as DD/MM/YYYY" rather than saving nothing.
 */

import { useEffect, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isIsoDate } from "./date-rules";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** "1990-05-01" → "01/05/1990"; anything else is shown as it was typed. */
function toText(v: string): string {
  const m = ISO.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** What is typed, as the value: ISO when it is a whole real date, else the text. */
function fromText(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return "";
  if (digits.length === 8) {
    const iso = `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
    if (isIsoDate(iso)) return iso;
  }
  return text;
}

/** Slashes go in as the digits are typed: 01051990 reads 01/05/1990. */
function mask(raw: string): string {
  // A pasted ISO date is taken as it is.
  if (ISO.test(raw.trim())) return toText(raw.trim());
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIso(new Date());

export function DateField({
  value,
  onChange,
  min,
  max,
  openAt,
  id,
  label,
  invalid,
  describedBy,
  testId,
  required,
  clearable,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /**
   * The earliest and latest dates the calendar offers, ISO. The latest is the
   * end of next year unless said (D105): nothing here is booked further ahead.
   */
  min?: string;
  max?: string;
  /** Where the calendar opens when nothing is chosen yet, ISO. Today otherwise. */
  openAt?: string;
  id?: string;
  /** Names the field for a screen reader when no <label> wraps it. */
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
  required?: boolean;
  /** An x beside the calendar that empties the date (D105). */
  clearable?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => toText(value));
  const [open, setOpen] = useState(false);

  // A value set from outside (the calendar, a reset) is shown; what is being
  // typed is left alone while it still means the same thing.
  useEffect(() => {
    setText((t) => (fromText(t) === value ? t : toText(value)));
  }, [value]);

  const chosen = isIsoDate(value) ? toDate(value) : undefined;
  const first = toDate(min && isIsoDate(min) ? min : "1900-01-01");
  const lastIso = max && isIsoDate(max) ? max : `${new Date().getFullYear() + 1}-12-31`;
  const last = toDate(lastIso);
  const startAt = chosen ?? toDate(openAt && isIsoDate(openAt) ? openAt : todayIso());
  const today = todayIso();
  const todayAllowed = (!min || today >= min) && (!max || today <= max);

  return (
    <span className={cn("relative flex min-w-0 items-center", className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        value={text}
        required={required}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        data-testid={testId}
        onChange={(e) => {
          const t = mask(e.target.value);
          setText(t);
          onChange(fromText(t));
        }}
        className={cn(
          "h-11 w-full min-w-0 rounded-md border border-input bg-background pl-3 font-mono text-sm aria-invalid:border-destructive",
          clearable ? "pr-20" : "pr-11",
        )}
      />
      {clearable && text !== "" && (
        <button
          type="button"
          aria-label={label ? `Clear ${label.toLowerCase()}` : "Clear the date"}
          onClick={() => {
            setText("");
            onChange("");
          }}
          className="absolute right-10 inline-flex h-11 w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              label ? `Choose ${label.toLowerCase()} from a calendar` : "Choose from a calendar"
            }
            data-testid={testId ? `${testId}-calendar` : undefined}
            className="absolute right-0 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <CalendarDays className="size-4" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={chosen}
            defaultMonth={startAt}
            startMonth={first}
            endMonth={last}
            disabled={[{ before: first }, { after: last }]}
            onSelect={(d) => {
              if (!d) return;
              const iso = toIso(d);
              setText(toText(iso));
              onChange(iso);
              setOpen(false);
            }}
          />
          <div className="flex justify-between gap-2 border-t border-border p-2">
            <button
              type="button"
              disabled={!todayAllowed}
              onClick={() => {
                setText(toText(today));
                onChange(today);
                setOpen(false);
              }}
              className="h-9 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted disabled:opacity-45"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setText("");
                onChange("");
                setOpen(false);
              }}
              className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              Clear
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

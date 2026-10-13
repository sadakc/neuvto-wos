/**
 * A small form for a handful of fields that sends only what changed. Used for
 * the statutory numbers (E6) and the record's own fields (E7).
 *
 * It opens from a button in the header of the panel it edits (D103): "Add …"
 * while the panel is empty, "Edit …" once anything is in it, so an empty panel
 * never offers to edit nothing. The form is a dialog, so it opens where the
 * button is rather than at the foot of the tab.
 *
 * Each field can name a rule (fieldRules.ts). A broken rule is said under the
 * field, in words, before anything is sent; the database checks the same rule
 * again for every other way in.
 *
 * A number held encrypted (D104) shows its last four, as the card does, with
 * Change beside it: nothing is cleared on opening, and only a number the Admin
 * chose to change is typed and sent.
 */

import { X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/shared/date-field";
import { DATE_FORMAT_MESSAGE, isIsoDate } from "@/components/shared/date-rules";
import { isAppError } from "@/platform/errors";
import { checkField, type FieldRule } from "../fieldRules";
import { humanise } from "../format";

/**
 * An "Add …" choice at the foot of a select. Choosing it opens a short form
 * under the select; whatever it creates becomes the select's value.
 */
export type AddChoice =
  | {
      kind: "name";
      /** The select's last option, like "Add a department…". */
      label: string;
      /** The new name's field label, like "New department". */
      prompt: string;
      rule?: FieldRule;
      /** A second, optional box: a designation's grade, a client site's client. */
      second?: { prompt: string; hint?: string; maxLength?: number };
      /** Creates it and returns the select value it should take. */
      create: (name: string, second: string) => Promise<string>;
    }
  | {
      kind: "pick";
      label: string;
      prompt: string;
      /** Who or what can be added, as [value, label]. */
      choices: () => Promise<[string, string][]>;
      /** Explains the pick, under it. */
      note?: string;
      create: (value: string) => Promise<string>;
    };

export type FieldSpec = {
  key: string;
  label: string;
  /**
   * "yearsMonths" is two dropdowns whose value is the whole months; "derived"
   * is shown, never edited (see `derive`).
   */
  kind?: "text" | "date" | "select" | "yearsMonths" | "derived";
  options?: readonly string[];
  /** What is on record, for a prefilled field. Numbers are never prefilled. */
  current?: string | null;
  placeholder?: string;
  /** Emptying it clears the value. Off for numbers, where empty means "keep what is on record". */
  clearable?: boolean;
  /** It may be corrected but never emptied (a name). */
  required?: boolean;
  /** Select options as [value, label]; plain strings are humanised. */
  labelled?: readonly (readonly [string, string])[];
  inputMode?: "numeric" | "email" | "tel";
  /** The rule a typed value must meet. */
  rule?: FieldRule;
  maxLength?: number;
  /** A select's empty choice. "Not recorded" unless it says otherwise. */
  emptyLabel?: string;
  add?: AddChoice;
  /** The last four of a number on record: shown in place of the field until Change. */
  masked?: string | null;
  /** What the form starts on when nothing is recorded (Indian, for a nationality). Saved if kept. */
  defaultValue?: string;
  /** A date's earliest and latest, and where its calendar opens when empty. ISO. */
  min?: string;
  max?: string;
  openAt?: string;
  /** For "derived": what to show, from the form's current values. */
  derive?: (vals: Record<string, string>) => ReactNode;
  /** A line under the field. */
  hint?: string;
};

const ADD = "__add__";

/** "Emergency contact" → "emergency contact", leaving "PF" and "IFSC" as they are. */
const lower = (title: string) => title.replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());

export function FieldEditor({
  id,
  title,
  fields,
  save,
  onSaved,
  label,
  accessibleLabel,
  filled = true,
  description,
  crossCheck,
}: {
  id: string;
  title: string;
  fields: FieldSpec[];
  save: (vals: Record<string, string | null>) => Promise<void>;
  onSaved: () => Promise<void> | void;
  /** The button's text. Defaults to "Add <title>" or "Edit <title>". */
  label?: string;
  /** The button's name for a screen reader, when its text alone ("Edit") is too short. */
  accessibleLabel?: string;
  /** Whether the panel holds anything yet: "Edit" if so, "Add" if not. */
  filled?: boolean;
  description?: ReactNode;
  /**
   * Rules between fields (D105: an old UAN is not the current one), as
   * field key → message. Asked of what is typed, after each field's own rule.
   */
  crossCheck?: (vals: Record<string, string>) => Record<string, string>;
}) {
  const initial = () =>
    Object.fromEntries(fields.map((f) => [f.key, f.current || f.defaultValue || ""]));
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Options created from an "Add …" choice while the form is open.
  const [added, setAdded] = useState<Record<string, [string, string][]>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The masked numbers the Admin has chosen to change.
  const [changing, setChanging] = useState<Record<string, boolean>>({});
  const formId = useId();

  const verb = filled ? "Edit" : "Add";
  const buttonText = label ?? `${verb} ${lower(title)}`;

  function problem(f: FieldSpec, value: string): string | null {
    if (f.required && value.trim() === "") return `${f.label} can't be empty.`;
    if (f.kind === "date" && value !== "" && !isIsoDate(value)) return DATE_FORMAT_MESSAGE;
    return checkField(f.rule, value);
  }

  function set(f: FieldSpec, value: string) {
    setVals((c) => ({ ...c, [f.key]: value }));
    // Once a field has been told it is wrong, it is told again as it is fixed.
    if (errors[f.key] !== undefined) {
      const p = problem(f, value);
      setErrors((e) => {
        const next = { ...e };
        if (p) next[f.key] = p;
        else delete next[f.key];
        return next;
      });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // Only what changed. An emptied field clears only where the field says it
    // may; an empty number field means "keep what is on record", so nothing on
    // these forms can blank a statutory number by accident.
    const changed: Record<string, string | null> = {};
    const found: Record<string, string> = {};
    for (const f of fields) {
      if (f.kind === "derived") continue;
      const now = vals[f.key].trim();
      const before = (f.current ?? "").trim();
      if (now === before) continue;
      const p = problem(f, now);
      if (p) {
        found[f.key] = p;
        continue;
      }
      if (now !== "") changed[f.key] = now;
      else if (f.clearable) changed[f.key] = null;
    }
    for (const [key, message] of Object.entries(crossCheck?.(vals) ?? {})) {
      found[key] ??= message;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (Object.keys(changed).length === 0) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await save(changed);
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid={`edit-${id}`}
        onClick={() => {
          setVals(initial());
          setErrors({});
          setAdded({});
          setAdding(null);
          setError("");
          setChanging({});
          setOpen(true);
        }}
        aria-label={accessibleLabel}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {buttonText}
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {verb} {lower(title)}
            </DialogTitle>
            <DialogDescription>
              {description ??
                (fields.some((f) => f.masked)
                  ? "Only what you change is saved. A number on record stays as it is unless you choose Change."
                  : "Only what you change is saved. The × in a box clears it.")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={submit}
            data-testid={`editor-${id}`}
            noValidate
            className="grid gap-3 sm:grid-cols-2"
          >
            {fields.map((f) => {
              const errId = `${formId}-${f.key}-error`;
              const bad = errors[f.key];
              const options: (readonly [string, string])[] = [
                ...(f.labelled ?? (f.options ?? []).map((o) => [o, humanise(o)] as const)),
                ...(added[f.key] ?? []),
              ];
              // What is on record is always among the choices, so the select
              // never shows something other than what is saved.
              const v = vals[f.key];
              if (f.kind === "select" && v && !options.some(([o]) => o === v)) {
                options.unshift([v, humanise(v)]);
              }
              const eyebrow =
                "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";
              if (f.kind === "derived") {
                return (
                  <div key={f.key} className="min-w-0 text-sm" data-testid={`derived-${f.key}`}>
                    <span className={eyebrow}>{f.label}</span>
                    <div className="mt-1 flex min-h-11 items-center rounded-md border border-dashed border-border px-3 text-foreground-secondary">
                      {f.derive?.(vals) ?? "—"}
                    </div>
                    {f.hint && <p className="mt-1 text-caption text-muted-foreground">{f.hint}</p>}
                  </div>
                );
              }
              if (f.kind === "yearsMonths") {
                const total = v === "" ? null : Number(v);
                const years = total === null ? "" : String(Math.floor(total / 12));
                const months = total === null ? "" : String(total % 12);
                // Choosing a number in either counts the other as 0 until it
                // is chosen; setting either back to its blank clears both.
                const put = (y: string, m: string) =>
                  set(f, y === "" || m === "" ? "" : String(Number(y) * 12 + Number(m)));
                return (
                  <fieldset key={f.key} className="min-w-0 text-sm">
                    <legend className={eyebrow}>{f.label}</legend>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <select
                        aria-label={`${f.label}, years`}
                        value={years}
                        onChange={(e) => put(e.target.value, months || "0")}
                        className="h-11 w-full rounded-md border border-input bg-background px-3"
                      >
                        <option value="">Years</option>
                        {Array.from({ length: 51 }, (_, i) => (
                          <option key={i} value={String(i)}>
                            {i === 1 ? "1 year" : `${i} years`}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`${f.label}, months`}
                        value={months}
                        onChange={(e) => put(years || "0", e.target.value)}
                        className="h-11 w-full rounded-md border border-input bg-background px-3"
                      >
                        <option value="">Months</option>
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i} value={String(i)}>
                            {i === 1 ? "1 month" : `${i} months`}
                          </option>
                        ))}
                      </select>
                    </div>
                    {f.hint && <p className="mt-1 text-caption text-muted-foreground">{f.hint}</p>}
                  </fieldset>
                );
              }
              if (f.masked && !changing[f.key]) {
                return (
                  <div key={f.key} className="min-w-0 text-sm" data-testid={`masked-${f.key}`}>
                    <span className={eyebrow}>{f.label}</span>
                    <div className="mt-1 flex h-11 items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3">
                      <span className="font-mono whitespace-nowrap">•••• {f.masked}</span>
                      <button
                        type="button"
                        onClick={() => setChanging((c) => ({ ...c, [f.key]: true }))}
                        aria-label={`Change ${f.label}`}
                        className="-mr-2 inline-flex h-11 items-center px-2 text-sm font-medium text-primary hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={f.key} className="min-w-0 text-sm">
                  <div className="relative">
                    <label className="block">
                      <span className={eyebrow}>{f.label}</span>
                      {f.kind === "select" ? (
                        <select
                          value={vals[f.key]}
                          onChange={(e) => {
                            if (e.target.value === ADD) setAdding(f.key);
                            else {
                              setAdding((a) => (a === f.key ? null : a));
                              set(f, e.target.value);
                            }
                          }}
                          aria-invalid={bad ? true : undefined}
                          aria-describedby={bad ? errId : undefined}
                          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3"
                        >
                          <option value="">{f.emptyLabel ?? "Not recorded"}</option>
                          {options.map(([value, text]) => (
                            <option key={value} value={value}>
                              {text}
                            </option>
                          ))}
                          {f.add && <option value={ADD}>{f.add.label}</option>}
                        </select>
                      ) : f.kind === "date" ? (
                        <DateField
                          label={f.label}
                          value={vals[f.key]}
                          onChange={(value) => set(f, value)}
                          min={f.min}
                          max={f.max}
                          openAt={f.openAt}
                          invalid={!!bad}
                          describedBy={bad ? errId : undefined}
                          clearable={f.clearable}
                          className="mt-1"
                        />
                      ) : (
                        // D105: a clearable box has an x at its right that empties
                        // it in one go, and room kept for it so text never runs under.
                        // The x sits outside the label, so the label names the box alone.
                        <span className="mt-1 block">
                          <input
                            type="text"
                            value={vals[f.key]}
                            autoFocus={!!f.masked}
                            onChange={(e) => set(f, e.target.value)}
                            placeholder={f.placeholder}
                            inputMode={f.inputMode}
                            maxLength={f.maxLength}
                            autoComplete="off"
                            aria-invalid={bad ? true : undefined}
                            aria-describedby={bad ? errId : undefined}
                            className={`h-11 w-full rounded-md border border-input bg-background pl-3 font-mono aria-invalid:border-destructive ${f.clearable ? "pr-11" : "pr-3"}`}
                          />
                        </span>
                      )}
                    </label>
                    {f.clearable &&
                      f.kind !== "select" &&
                      f.kind !== "date" &&
                      vals[f.key] !== "" && (
                        <button
                          type="button"
                          aria-label={`Clear ${f.label}`}
                          onClick={() => set(f, "")}
                          className="absolute right-0 bottom-0 inline-flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      )}
                  </div>
                  {f.masked && (
                    <button
                      type="button"
                      onClick={() => {
                        setChanging((c) => ({ ...c, [f.key]: false }));
                        set(f, f.current ?? "");
                        setErrors((e) => {
                          const next = { ...e };
                          delete next[f.key];
                          return next;
                        });
                      }}
                      className="mt-1 inline-flex min-h-9 items-center text-sm text-primary hover:underline"
                    >
                      Keep •••• {f.masked}
                    </button>
                  )}
                  {f.hint && <p className="mt-1 text-caption text-muted-foreground">{f.hint}</p>}
                  {bad && (
                    <p id={errId} role="alert" className="mt-1 text-sm text-destructive">
                      {bad}
                    </p>
                  )}
                  {f.add && adding === f.key && (
                    <AddInline
                      choice={f.add}
                      onCancel={() => setAdding(null)}
                      onAdded={(value, text) => {
                        setAdded((a) => ({ ...a, [f.key]: [...(a[f.key] ?? []), [value, text]] }));
                        setAdding(null);
                        set(f, value);
                      }}
                    />
                  )}
                </div>
              );
            })}
            {error && (
              <p
                role="alert"
                data-testid={`editor-${id}-error`}
                className="text-sm text-destructive sm:col-span-2"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={busy || adding !== null}
                data-testid={`save-${id}`}
                className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="h-11 rounded-md border border-border px-4 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The short form an "Add …" choice opens, under its select. */
export function AddInline({
  choice,
  onAdded,
  onCancel,
}: {
  choice: AddChoice;
  onAdded: (value: string, label: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [second, setSecond] = useState("");
  const [picks, setPicks] = useState<[string, string][] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const secondId = useId();

  useEffect(() => {
    if (choice.kind !== "pick") return;
    let cancelled = false;
    choice
      .choices()
      .then((p) => !cancelled && setPicks(p))
      .catch((err) => {
        if (cancelled) return;
        setPicks([]);
        setError(isAppError(err) ? err.message : "The list didn't load.");
      });
    return () => {
      cancelled = true;
    };
  }, [choice]);

  async function add() {
    setError("");
    if (choice.kind === "name") {
      const v = name.trim();
      if (!v) return setError(`${choice.prompt} needs a name.`);
      const p = checkField(choice.rule, v);
      if (p) return setError(p);
      setBusy(true);
      try {
        onAdded(await choice.create(v, second.trim()), v);
      } catch (err) {
        setError(isAppError(err) ? err.message : "That couldn't be added.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!pick) return setError("Choose somebody.");
    setBusy(true);
    try {
      const text = picks?.find(([v]) => v === pick)?.[1] ?? "";
      onAdded(await choice.create(pick), text);
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be done.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="add-inline"
      className="mt-2 rounded-md border border-border bg-secondary/40 p-3"
      // Enter adds rather than saving the whole form.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          void add();
        }
      }}
    >
      <label htmlFor={inputId} className="block text-sm font-medium">
        {choice.prompt}
      </label>
      {choice.kind === "name" ? (
        <input
          id={inputId}
          value={name}
          maxLength={100}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3"
        />
      ) : null}
      {choice.kind === "name" && choice.second && (
        <>
          <label htmlFor={secondId} className="mt-2 block text-sm font-medium">
            {choice.second.prompt}
          </label>
          <input
            id={secondId}
            value={second}
            maxLength={choice.second.maxLength ?? 100}
            onChange={(e) => setSecond(e.target.value)}
            className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3"
          />
          {choice.second.hint && (
            <p className="mt-1 text-caption text-muted-foreground">{choice.second.hint}</p>
          )}
        </>
      )}
      {choice.kind === "pick" ? (
        <select
          id={inputId}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3"
        >
          <option value="">{picks === null ? "Loading…" : "Choose…"}</option>
          {(picks ?? []).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      ) : null}
      {choice.kind === "pick" && choice.note && (
        <p className="mt-1 text-caption text-muted-foreground">{choice.note}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

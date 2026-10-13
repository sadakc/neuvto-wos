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
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
      /** Creates it and returns the select value it should take. */
      create: (name: string) => Promise<string>;
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
  kind?: "text" | "date" | "select";
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
};

const ADD = "__add__";

export function FieldEditor({
  id,
  title,
  fields,
  save,
  onSaved,
  label,
  filled = true,
  description,
}: {
  id: string;
  title: string;
  fields: FieldSpec[];
  save: (vals: Record<string, string | null>) => Promise<void>;
  onSaved: () => Promise<void> | void;
  /** The button's text. Defaults to "Add <title>" or "Edit <title>". */
  label?: string;
  /** Whether the panel holds anything yet: "Edit" if so, "Add" if not. */
  filled?: boolean;
  description?: ReactNode;
}) {
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, f.current ?? ""]));
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Options created from an "Add …" choice while the form is open.
  const [added, setAdded] = useState<Record<string, [string, string][]>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();

  const verb = filled ? "Edit" : "Add";
  const buttonText = label ?? `${verb} ${title.toLowerCase()}`;

  function problem(f: FieldSpec, value: string): string | null {
    if (f.required && value.trim() === "") return `${f.label} can't be empty.`;
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
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {buttonText}
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {verb} {title.toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              {description ?? "Only what you change is saved. Empty a field to clear it."}
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
              const options = [
                ...(f.labelled ?? (f.options ?? []).map((o) => [o, humanise(o)] as const)),
                ...(added[f.key] ?? []),
              ];
              return (
                <div key={f.key} className="min-w-0 text-sm">
                  <label className="block">
                    <span className="block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
                      {f.label}
                    </span>
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
                    ) : (
                      <input
                        type={f.kind === "date" ? "date" : "text"}
                        value={vals[f.key]}
                        onChange={(e) => set(f, e.target.value)}
                        placeholder={f.placeholder}
                        inputMode={f.inputMode}
                        maxLength={f.maxLength}
                        autoComplete="off"
                        aria-invalid={bad ? true : undefined}
                        aria-describedby={bad ? errId : undefined}
                        className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 font-mono aria-invalid:border-destructive"
                      />
                    )}
                  </label>
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
  const [picks, setPicks] = useState<[string, string][] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();

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
        onAdded(await choice.create(v), v);
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
      ) : (
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
      )}
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

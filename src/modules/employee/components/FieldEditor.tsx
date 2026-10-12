/**
 * A small form that opens from a button, edits a handful of fields and sends
 * only what changed. Used for the statutory numbers (E6) and the record's own
 * fields (E7); both are Admin-or-role writes of a few values at a time.
 */

import { useState } from "react";
import { isAppError } from "@/platform/errors";
import { humanise } from "../format";

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
  /** Select options as [value, label]; plain strings are humanised. */
  labelled?: readonly (readonly [string, string])[];
  inputMode?: "numeric" | "email" | "tel";
};

export function FieldEditor({
  id,
  title,
  fields,
  save,
  onSaved,
  label,
}: {
  id: string;
  title: string;
  fields: FieldSpec[];
  save: (vals: Record<string, string | null>) => Promise<void>;
  onSaved: () => Promise<void> | void;
  /** The closed button's text. Defaults to "Edit <title>". */
  label?: string;
}) {
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, f.current ?? ""]));
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // Only what changed. An emptied field clears only where the field says it
    // may; an empty number field means "keep what is on record", so nothing on
    // these forms can blank a statutory number by accident.
    const changed: Record<string, string | null> = {};
    for (const f of fields) {
      const now = vals[f.key].trim();
      const before = (f.current ?? "").trim();
      if (now === before) continue;
      if (now !== "") changed[f.key] = now;
      else if (f.clearable) changed[f.key] = null;
    }
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

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`edit-${id}`}
        onClick={() => {
          setVals(initial());
          setError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        {label ?? `Edit ${title.toLowerCase()}`}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      data-testid={`editor-${id}`}
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <h3 className="text-card-title font-semibold tracking-card-title">{title}</h3>
      <div className="mt-3 grid gap-3 @min-[640px]/app:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="min-w-0 text-sm">
            <span className="block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
              {f.label}
            </span>
            {f.kind === "select" ? (
              <select
                value={vals[f.key]}
                onChange={(e) => setVals((c) => ({ ...c, [f.key]: e.target.value }))}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Not recorded</option>
                {(f.labelled ?? (f.options ?? []).map((o) => [o, humanise(o)] as const)).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            ) : (
              <input
                type={f.kind === "date" ? "date" : "text"}
                value={vals[f.key]}
                onChange={(e) => setVals((c) => ({ ...c, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                inputMode={f.inputMode}
                autoComplete="off"
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 font-mono"
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          data-testid={`editor-${id}-error`}
          className="mt-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          data-testid={`save-${id}`}
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

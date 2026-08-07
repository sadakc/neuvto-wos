/**
 * Departments, as an administrator sets them up.
 *
 * The gap Sada found from the other end: "within reports, I see a drop down for
 * the departments, but I do not see it anywhere else to select what department
 * an individual can be added to."
 *
 * The table has existed since the first migration and nothing could ever write
 * a row, so the Department column on both leave reports was blank for everybody
 * and the spreadsheet import warned "No department called X" on every row that
 * named one. This is the missing write side.
 *
 * Contributed to Settings alongside the working calendar and company identity.
 * Hierarchy is deliberately not exposed yet — `parent_department_id` exists and
 * is preserved, but a tree editor is a different screen and nobody has asked for
 * one. A flat list is what makes the reports work.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  DepartmentInput,
  listDepartments,
  removeDepartment,
  saveDepartment,
  type Department,
} from ".";

export function Departments({ organizationId }: { organizationId: string }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  /** Which one is awaiting confirmation. Inline, because the count has to be visible. */
  const [removing, setRemoving] = useState<Department | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setDepartments(await listDepartments());
  }

  useEffect(() => {
    let cancelled = false;
    listDepartments()
      .then((d) => {
        if (cancelled) return;
        setDepartments(d);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await saveDepartment(DepartmentInput.parse({ name }), organizationId);
      setName("");
      await load();
    } catch (err) {
      setError(message(err, "That department couldn't be added."));
    } finally {
      setBusy(false);
    }
  }

  async function onRename() {
    if (!editing) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await saveDepartment(DepartmentInput.parse(editing), organizationId);
      setEditing(null);
      await load();
    } catch (err) {
      setError(message(err, "That name couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(d: Department) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const { peopleUnassigned } = await removeDepartment(d.id);
      setRemoving(null);
      // Says what happened to the people, because the alternative is finding out
      // from a report with a blank column.
      setNotice(
        peopleUnassigned === 0
          ? `“${d.name}” removed. Nobody was in it.`
          : `“${d.name}” removed. ${peopleUnassigned} ${peopleUnassigned === 1 ? "person is" : "people are"} no longer in a department.`,
      );
      await load();
    } catch (err) {
      setError(message(err, "That department couldn't be removed."));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="h-32 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your departments just now. Try refreshing.
      </p>
    );
  }

  return (
    <div>
      {departments.length === 0 && (
        <p className="mb-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No departments yet. Until you add some, the Department column on every report stays empty
          and a spreadsheet import can&apos;t place anybody.
        </p>
      )}

      <form onSubmit={onAdd} className="flex flex-col gap-3 sm:flex-row">
        <input
          aria-label="Department name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder="Operations"
          maxLength={100}
          data-testid="department-name"
          className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          data-testid="add-department"
          className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error && (
        <p role="alert" data-testid="departments-error" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          data-testid="departments-notice"
          className="mt-4 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}

      {departments.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {departments.map((d) => (
            <li key={d.id} data-testid="department-row" className="p-4">
              {editing?.id === d.id ? (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    aria-label={`Rename ${d.name}`}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    maxLength={100}
                    className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <button
                    onClick={onRename}
                    disabled={busy || !editing.name.trim()}
                    data-testid="save-department"
                    className="inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditing(null);
                      setError("");
                    }}
                    className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.memberCount === 0
                        ? "Nobody in it yet"
                        : `${d.memberCount} ${d.memberCount === 1 ? "person" : "people"}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      onClick={() => {
                        setError("");
                        setEditing({ id: d.id, name: d.name });
                      }}
                      className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        setError("");
                        setRemoving(d);
                      }}
                      data-testid="remove-department"
                      className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                    >
                      Remove
                    </button>
                  </span>
                </div>
              )}

              {/* Inline rather than a dialog: the number of people affected is
                  the whole decision, and it belongs in front of the person
                  making it rather than behind a modal. */}
              {removing?.id === d.id && (
                <div
                  data-testid="remove-confirm"
                  className="mt-3 rounded-md border border-border bg-secondary/30 p-4"
                >
                  <p className="text-sm font-medium">Remove “{d.name}”?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {d.memberCount === 0
                      ? "Nobody is in it, so nothing else changes."
                      : `${d.memberCount} ${d.memberCount === 1 ? "person" : "people"} will no longer be in a department. Their leave, balances and approvals are untouched.`}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onRemove(d)}
                      disabled={busy}
                      data-testid="confirm-remove-department"
                      className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? "Removing…" : "Remove"}
                    </button>
                    <button
                      onClick={() => setRemoving(null)}
                      className="inline-flex min-h-12 items-center rounded-md border border-border px-4 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A Zod message is written for the reader; anything else is already translated. */
function message(err: unknown, fallback: string): string {
  if (isAppError(err)) return err.message;
  if (err instanceof Error && "issues" in err) {
    return (err as { issues: { message: string }[] }).issues[0].message;
  }
  return fallback;
}

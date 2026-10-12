/**
 * Blackout periods (Leave phase 2, criterion 7): named date ranges when nobody
 * can apply for leave of any kind, paid or unpaid. The Leave Admin adds and
 * removes them; everybody sees them, so Apply can say so before sending.
 *
 * Leave already applied for is never touched. A blackout added over an
 * approved holiday leaves the holiday approved; the database refuses only new
 * requests, by the blackout's name.
 */

import { useEffect, useState } from "react";
import { getCurrentUser, type CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { getBlackouts, removeBlackout, saveBlackout } from "../handlers";
import type { Blackout } from "../contracts";
import { ConfirmRemoval } from "./ConfirmRemoval";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function Blackouts() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<Blackout[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Blackout | null>(null);

  async function load() {
    setItems(await getBlackouts());
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCurrentUser(), getBlackouts()])
      .then(([u, b]) => {
        if (cancelled) return;
        setUser(u);
        setItems(b);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const backwards = !!fromDate && !!toDate && toDate < fromDate;
  const canSave = !!name.trim() && !!fromDate && !!toDate && !backwards && !saving;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSave) return;
    setError("");
    setSaving(true);
    try {
      await saveBlackout({ name: name.trim(), fromDate, toDate }, user.organizationId);
      await load();
      setAdding(false);
      setName("");
      setFromDate("");
      setToDate("");
    } catch (err) {
      setError(isAppError(err) ? err.message : "That blackout period couldn't be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(b: Blackout) {
    setRemoving(null);
    setError("");
    try {
      await removeBlackout(b.id);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That blackout period couldn't be removed.");
    }
  }

  if (items === null) return <div className="h-24 animate-pulse rounded-lg bg-muted" />;

  return (
    <div>
      {items.length === 0 ? (
        !adding && (
          <p className="mb-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            No blackout periods. Leave can be applied for on any working day.
          </p>
        )
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-card">
          {items.map((b) => (
            <li
              key={b.id}
              data-testid="blackout-row"
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{b.name}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {b.fromDate === b.toDate
                    ? formatDate(b.fromDate)
                    : `${formatDate(b.fromDate)} to ${formatDate(b.toDate)}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setRemoving(b)}
                className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          data-testid="add-blackout"
          className="mt-4 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Add a blackout period
        </button>
      ) : (
        <form
          onSubmit={onSave}
          className="mt-4 space-y-4 rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <div>
            <label htmlFor="bo-name" className="block text-sm font-medium">
              Name
            </label>
            <input
              id="bo-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Year-end audit"
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          <div className="grid gap-4 @min-[560px]/app:grid-cols-2">
            <div>
              <label htmlFor="bo-from" className="block text-sm font-medium">
                From
              </label>
              <input
                id="bo-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="bo-to" className="block text-sm font-medium">
                To
              </label>
              <input
                id="bo-to"
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>
          {backwards && (
            <p data-testid="blackout-dates-error" className="text-sm text-destructive">
              The last day is before the first.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Nobody can apply for leave that touches these dates, paid or unpaid. Leave already
            applied for is not changed.
          </p>
          <div className="flex flex-col gap-3 @min-[640px]/app:flex-row">
            <button
              type="submit"
              disabled={!canSave}
              data-testid="save-blackout"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add blackout period"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ConfirmRemoval
        open={removing !== null}
        title={`Remove ${removing?.name ?? "this blackout period"}?`}
        action="Remove blackout"
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void onRemove(removing)}
      >
        <p>People will be able to apply for leave on those dates again.</p>
        <p>Leave already applied for is not changed, and nothing refused before is reopened.</p>
      </ConfirmRemoval>
    </div>
  );
}

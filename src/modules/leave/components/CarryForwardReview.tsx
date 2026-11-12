/**
 * The carry-forward review (D91): what each person takes into next year.
 *
 * Nothing on this screen touches a balance until the review is locked. The
 * rule (each type's "carry over up to") proposes; the Leave Admin can change
 * any line within what the person has left; locking applies every line at
 * once, and is final. The database refuses a lock before next year opens or
 * after any balance has moved, so what is applied is what was on screen.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { adjustCarry, getCarryReview, getCarryYears, lockCarry, prepareCarry } from "../handlers";
import type { CarryLine, CarryReview } from "../contracts";

const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export default function CarryForwardReview() {
  const [years, setYears] = useState<{ current: string; previous: string } | null>(null);
  const [fy, setFy] = useState("");
  const [review, setReview] = useState<CarryReview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Remounts the uncontrolled inputs on every load (see OpeningBalances).
  const [version, setVersion] = useState(0);

  async function load(year: string) {
    setReview(await getCarryReview(year));
    setVersion((v) => v + 1);
  }

  useEffect(() => {
    let cancelled = false;
    getCarryYears()
      .then(async (y) => {
        if (cancelled) return;
        setYears(y);
        setFy(y.previous);
        await load(y.previous);
        if (!cancelled) setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setError("");
    setNotice("");
    setBusy(key);
    try {
      await fn();
      if (done) setNotice(done);
      await load(fy);
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't work. Please try again.");
      await load(fy).catch(() => {});
    } finally {
      setBusy("");
    }
  }

  async function choose(year: string) {
    setFy(year);
    setError("");
    setNotice("");
    try {
      await load(year);
    } catch {
      setState("error");
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (state === "error" || !years) {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load the carry-forward review just now. Try refreshing.
      </p>
    );
  }

  const locked = review?.status === "locked";
  const days = (l: CarryLine) => l.adjustedDays ?? l.proposedDays;
  const people = review ? new Set(review.lines.map((l) => l.employeeName)).size : 0;
  const total = review ? review.lines.reduce((n, l) => n + days(l), 0) : 0;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Leave year</legend>
        {[years.previous, years.current].map((y) => (
          <label
            key={y}
            className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-border px-3"
          >
            <input
              type="radio"
              name="carry-year"
              aria-label={y}
              checked={fy === y}
              onChange={() => void choose(y)}
              className="size-4 accent-primary"
            />
            <span className="text-sm">{y}</span>
          </label>
        ))}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {!review ? (
        <div className="rounded-xl border border-dashed border-border p-6">
          <p className="text-sm text-muted-foreground">{fy} hasn&apos;t been reviewed yet.</p>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void run("prepare", () => prepareCarry(fy))}
            className="mt-3 inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
          >
            {busy === "prepare" ? "Preparing…" : "Prepare the review"}
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {locked
              ? `Locked by ${review.lockedBy ?? "an administrator"}${
                  review.lockedAt ? ` on ${review.lockedAt.slice(0, 10)}` : ""
                }. These days were carried into ${review.toFy}.`
              : `Carrying ${review.fromFy} into ${review.toFy}. Nothing changes until you lock it.`}
          </p>

          {review.lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Nobody has days of a type that carries over. Set &ldquo;Carry over up to&rdquo; on a
              leave type, then prepare the review again.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-card">
              {review.lines.map((l) => (
                <li key={l.id} data-testid="carry-line" className="p-4">
                  <span className="block text-sm font-medium">{l.employeeName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.leaveTypeName} · {l.availableDays} left · the rule carries {l.proposedDays}{" "}
                    (up to {l.carryForwardMax})
                  </span>
                  {l.adjustedDays !== null && (
                    <span className="block text-xs font-medium">Changed from {l.proposedDays}</span>
                  )}
                  {locked ? (
                    <p className="mt-2 text-sm">Carried: {plural(days(l))}</p>
                  ) : (
                    <form
                      key={`${l.id}:${version}`}
                      className="mt-2 flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = Number(new FormData(e.currentTarget).get("days"));
                        void run(l.id, () => adjustCarry(l.id, v));
                      }}
                    >
                      <input
                        name="days"
                        type="number"
                        min={0}
                        step="0.5"
                        defaultValue={days(l)}
                        aria-label={`Days to carry for ${l.employeeName}, ${l.leaveTypeName}`}
                        className="h-12 w-28 rounded-md border border-border bg-background px-3 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={busy !== ""}
                        className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-45"
                      >
                        Save
                      </button>
                      {l.adjustedDays !== null && (
                        <button
                          type="button"
                          disabled={busy !== ""}
                          onClick={() => void run(l.id, () => adjustCarry(l.id, null))}
                          className="text-sm underline underline-offset-4"
                        >
                          Use the rule&apos;s {l.proposedDays}
                        </button>
                      )}
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!locked && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== ""}
                  onClick={() => void run("prepare", () => prepareCarry(fy))}
                  className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-45"
                >
                  Prepare again
                </button>
                <button
                  type="button"
                  disabled={busy !== "" || !review.nextYearOpen || review.lines.length === 0}
                  onClick={() => setConfirming(true)}
                  className="inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                >
                  Lock and apply to {review.toFy}
                </button>
              </div>
              {!review.nextYearOpen && (
                <p className="text-xs text-muted-foreground">
                  {review.toFy} isn&apos;t open yet. You can lock this once it opens.
                </p>
              )}
            </div>
          )}

          <AlertDialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lock the {review.fromFy} review?</AlertDialogTitle>
                <AlertDialogDescription>
                  This sets the carried-over days of {people} {people === 1 ? "person" : "people"}{" "}
                  in {review.toFy}, {plural(total)} in all. A locked review can&apos;t be changed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Not yet</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirming(false);
                    void run(
                      "lock",
                      () => lockCarry(review.id),
                      `Locked. Carried-over days are set in ${review.toFy}.`,
                    );
                  }}
                >
                  Lock the review
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

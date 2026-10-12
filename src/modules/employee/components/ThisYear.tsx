/**
 * Two parts of the card's Overview: "This year" (D97) and "Who has looked"
 * (D100).
 *
 * Each is asked for only when the card says the viewer may see it
 * (capabilities.canSeeThisYear, canSeeViews); the database refuses anybody
 * else either way, so the capability only stops a dead request.
 */

import { useEffect, useState } from "react";
import type { CardView, ThisYear } from "../contracts";
import { formatDate } from "../format";
import { getThisYear, listCardViews } from "../handlers";
import { Panel } from "./parts";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Overview's fourth card: leave left of each kind, and what is waiting on a decision. */
export function ThisYearPanel({ employeeId }: { employeeId: string }) {
  const [year, setYear] = useState<ThisYear | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getThisYear(employeeId)
      .then((y) => !cancelled && setYear(y))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const waiting = year
    ? [
        ...year.openRequests.map((r) => `${r.label}: ${r.count}`),
        ...(year.openCorrections ? [`Record corrections: ${year.openCorrections}`] : []),
      ]
    : [];

  return (
    <Panel
      title="This year"
      testId="panel-this-year"
      aside={year?.leaveYear ? `Leave year ${year.leaveYear}` : null}
    >
      {failed ? (
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this year just now. Try refreshing.
        </p>
      ) : !year ? (
        <div className="h-20 animate-pulse rounded bg-muted" />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {year.leave && year.leave.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Leave left">
              {year.leave.map((l) => (
                <li key={l.leaveTypeId} className="flex flex-wrap justify-between gap-x-3">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-foreground-secondary">
                    {l.available} of {days(l.entitled)} left
                    {l.pending > 0 ? ` · ${l.pending} awaiting a decision` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
              Open requests
            </p>
            {waiting.length ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {waiting.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-foreground-secondary">Nothing waiting on a decision.</p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Who has opened this record, for the person and a Super Admin. */
export function WhoHasLooked({ employeeId }: { employeeId: string }) {
  const [views, setViews] = useState<CardView[] | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => {
          if (views) return setViews(null);
          setError("");
          void listCardViews(employeeId)
            .then(setViews)
            .catch(() => setError("We couldn't load who has looked."));
        }}
        className="underline underline-offset-4"
      >
        {views ? "Hide who has looked" : "Who has looked at this record"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      )}
      {views && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="card-views">
          {views.length === 0 && <li>Nobody else has opened it yet.</li>}
          {views.map((v, i) => (
            <li key={i}>
              {v.viewerName} looked on {formatDate(v.viewedAt)}
            </li>
          ))}
          <li>Looks within ten minutes count once. Kept for three years.</li>
        </ul>
      )}
    </div>
  );
}

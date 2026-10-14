/**
 * Apply for leave — PRD AC1, AC2, AC3.
 *
 * AC3 asks for a submission in under thirty seconds on a phone, so the whole
 * form is one screen with no steps: type, dates, reason, send.
 *
 * The working-day count and the balance line come from the database, never from
 * arithmetic here. A weekend rule computed in the browser will one day disagree
 * with the one in Postgres, and the employee meets that as a form which accepts
 * a request the server then refuses.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  getMyWorkingDays,
  getMyExcludedDays,
  describeExcludedDays,
  type ExcludedDay,
} from "@/platform/calendar";
import { getCurrentUser, isModuleAdmin, type CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { DateField } from "@/components/shared/date-field";
import { DATE_FORMAT_MESSAGE, isIsoDate } from "@/components/shared/date-rules";
import { Panel } from "@/components/shared/panel";
import { getBlackouts, getLeaveTypes, getMyBalances, getMyUnpaid, submitLeave } from "../handlers";
import type { Blackout, LeaveBalance, LeaveKind, UnpaidSummary } from "../contracts";

type LeaveType = { id: string; name: string; kind: LeaveKind };

/** Today in ISO, for the date inputs' `min`. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EYEBROW = "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";

export default function ApplyLeave() {
  const navigate = useNavigate();

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  /** Leave phase 2: unpaid leave has no balance, only what was taken. */
  const [unpaid, setUnpaid] = useState<UnpaidSummary[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [loading, setLoading] = useState(true);

  const [typeId, setTypeId] = useState("");
  // What is in the date boxes: an ISO date once it is a whole, real one, else
  // the half-typed text. Everything below works from the whole dates only.
  const [fromRaw, setFromRaw] = useState("");
  const [toRaw, setToRaw] = useState("");
  const fromDate = isIsoDate(fromRaw) ? fromRaw : "";
  const toDate = isIsoDate(toRaw) ? toRaw : "";
  const [reason, setReason] = useState("");

  const [workingDays, setWorkingDays] = useState<number | null>(null);
  const [excluded, setExcluded] = useState<ExcludedDay[]>([]);
  const [countingDays, setCountingDays] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const minDate = todayIso();

  useEffect(() => {
    Promise.all([getCurrentUser(), getLeaveTypes(), getMyBalances()])
      .then(([u, t, b]) => {
        setUser(u);
        setTypes(t);
        setBalances(b);
        if (t.length === 1) setTypeId(t[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // Separately and forgivingly: the database refuses a blackout and counts
    // unpaid leave whether or not these load; they only let the form say so
    // before sending.
    getMyUnpaid()
      .then(setUnpaid)
      .catch(() => {});
    getBlackouts()
      .then(setBlackouts)
      .catch(() => {});
  }, []);

  const balance = useMemo(
    () => balances.find((b) => b.leaveTypeId === typeId) ?? null,
    [balances, typeId],
  );
  const isUnpaid = types.find((t) => t.id === typeId)?.kind === "unpaid";
  const unpaidSummary = unpaid.find((u) => u.leaveTypeId === typeId) ?? null;
  // ISO dates compare as strings. Inclusive at both ends, as the database's.
  const blackout =
    fromDate && toDate
      ? (blackouts.find((b) => b.fromDate <= toDate && b.toDate >= fromDate) ?? null)
      : null;

  // Asked of the database on every date change, debounced. Deliberately not
  // computed here — see the header.
  useEffect(() => {
    if (!user || !fromDate || !toDate || toDate < fromDate) {
      setWorkingDays(null);
      setExcluded([]);
      return;
    }
    let cancelled = false;
    setCountingDays(true);
    const timer = setTimeout(() => {
      // The count and the reason together. If the explanation fails the count
      // still shows — a missing sentence is worse than nothing, but a missing
      // number stops the form.
      Promise.all([
        // D102: on the applicant's own calendar, which their unit decides.
        getMyWorkingDays(fromDate, toDate),
        getMyExcludedDays(fromDate, toDate).catch(() => []),
      ])
        .then(([d, x]) => {
          if (cancelled) return;
          setWorkingDays(d);
          setExcluded(x);
        })
        .catch(() => {
          if (!cancelled) {
            setWorkingDays(null);
            setExcluded([]);
          }
        })
        .finally(() => {
          if (!cancelled) setCountingDays(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, fromDate, toDate]);

  // A refusal from the server describes the request that was refused, so it stops
  // being true the moment that request changes.
  //
  // Found by applying over dates that clashed, being told so correctly, then
  // moving to free dates and still being told. The error was only ever cleared
  // at the top of onSubmit, so it survived every edit until the next send — and
  // "you already have leave booked over some of those dates" sitting under a set
  // of dates that are perfectly free reads as the form being broken, or worse,
  // as the clash being real and the employee not seeing why.
  //
  // Keyed on the three fields the server actually judges. The reason is not one
  // of them: nothing about editing it can make a refusal wrong.
  useEffect(() => {
    setError("");
  }, [typeId, fromDate, toDate]);

  /** "10 to 15 August is 6 days — why am I charged 5?" See describeExcludedDays. */
  const exclusionNote = useMemo(() => describeExcludedDays(excluded), [excluded]);

  const available = balance?.availableDays ?? null;
  const remaining = available !== null && workingDays !== null ? available - workingDays : null;

  // AC2. The message carries the numbers, because "insufficient balance" tells
  // an employee nothing they can act on.
  // Unpaid leave has no balance row (the database creates none), so `balance`
  // is null for it and there is never a shortfall to show.
  const shortfall =
    available !== null && workingDays !== null && workingDays > available
      ? `You need ${workingDays} ${workingDays === 1 ? "day" : "days"} but have ${available} available.`
      : "";

  const noWorkingDays = workingDays === 0;
  // AC1. The calendar offers no past day; a typed one is said at once.
  const dateProblem =
    (fromRaw && !fromDate) || (toRaw && !toDate)
      ? DATE_FORMAT_MESSAGE
      : fromDate && fromDate < minDate
        ? "The first day can't be in the past."
        : fromDate && toDate && toDate < fromDate
          ? "The last day can't be before the first."
          : "";
  const canSubmit =
    !dateProblem &&
    !!typeId &&
    !!fromDate &&
    !!toDate &&
    toDate >= fromDate &&
    !!workingDays &&
    !shortfall &&
    !blackout &&
    !countingDays &&
    !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await submitLeave({ leaveTypeId: typeId, fromDate, toDate, reason: reason || undefined });
      setDone(true);
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't work. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-64 max-w-lg animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  // AC3 — confirmation immediately, not a redirect the employee has to interpret.
  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h1 className="text-page-title font-semibold tracking-page-title">Request sent</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your leave request is with your approver. You&apos;ll get an email when it&apos;s
            decided.
          </p>
          <div className="mt-6 flex flex-col gap-3 @min-[640px]/app:flex-row">
            <button
              onClick={() => navigate({ to: "/app/$", params: { _splat: "leave" } })}
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              See my leave
            </button>
            <button
              onClick={() => {
                setDone(false);
                setFromRaw("");
                setToRaw("");
                setReason("");
                setWorkingDays(null);
                getMyBalances()
                  .then(setBalances)
                  .catch(() => {});
              }}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Apply for more
            </button>
          </div>
        </div>
      </div>
    );
  }

  // The same dead end the dashboard used to offer, reached the other way. An
  // administrator gets the fix; everybody else gets told who has it.
  if (types.length === 0) {
    return (
      <div className="max-w-lg">
        <h1 className="text-page-title font-semibold tracking-page-title">Apply for leave</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isModuleAdmin(user, "leave")
            ? "No leave types are set up yet, so there's nothing to apply for."
            : "No leave types have been set up yet. Ask your administrator to add them."}
        </p>
        {isModuleAdmin(user, "leave") && (
          <Link
            to="/app/settings"
            className="mt-5 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Set up leave types
          </Link>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Apply for leave</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Choose the type and the days. What it costs is worked out as you go, weekends and holidays
          left out, and the request goes to your approver.
        </p>
      </div>

      <div className="grid gap-4 @min-[800px]/app:grid-cols-2 @min-[800px]/app:items-start">
        <Panel title="Your request" testId="panel-request">
          <div className="grid gap-4">
            <div>
              <label htmlFor="leave-type" className={EYEBROW}>
                Leave type
              </label>
              <select
                id="leave-type"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Choose…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* AC1 — the calendar offers no past day; a typed one is said at once. */}
            <div className="grid grid-cols-1 gap-4 @min-[560px]/app:grid-cols-2">
              <div>
                <label htmlFor="from-date" className={EYEBROW}>
                  First day
                </label>
                <DateField
                  id="from-date"
                  value={fromRaw}
                  min={minDate}
                  invalid={
                    !!dateProblem && dateProblem !== "The last day can't be before the first."
                  }
                  describedBy={dateProblem ? "date-problem" : undefined}
                  onChange={(v) => {
                    setFromRaw(v);
                    if (isIsoDate(v) && toDate && v > toDate) setToRaw(v);
                  }}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="to-date" className={EYEBROW}>
                  Last day
                </label>
                <DateField
                  id="to-date"
                  value={toRaw}
                  min={fromDate || minDate}
                  openAt={fromDate || undefined}
                  invalid={dateProblem === "The last day can't be before the first."}
                  describedBy={dateProblem ? "date-problem" : undefined}
                  onChange={setToRaw}
                  className="mt-1"
                />
              </div>
            </div>
            {dateProblem && (
              <p
                id="date-problem"
                data-testid="date-problem"
                className="-mt-2 text-sm text-destructive"
              >
                {dateProblem}
              </p>
            )}

            <div>
              <label htmlFor="reason" className={EYEBROW}>
                Reason <span className="normal-case">(optional)</span>
              </label>
              <textarea
                id="reason"
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm"
              />
              <p className="mt-1 text-caption text-muted-foreground">{reason.length}/500</p>
            </div>

            {error && (
              <p data-testid="submit-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="submit-leave"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45 @min-[640px]/app:w-auto @min-[640px]/app:justify-self-start"
            >
              {submitting ? "Sending…" : "Send request"}
            </button>
          </div>
        </Panel>

        <Panel
          title="What it costs"
          testId="panel-cost"
          footer="Days are taken from your balance when you apply, and given back if the request is declined or cancelled."
        >
          <div className="grid gap-3">
            {!balance && !isUnpaid && (
              <p className="text-sm text-muted-foreground">
                Choose a leave type to see your balance.
              </p>
            )}
            {/* The live line the PRD asks for. Only shown once there is something true
          to say — a balance line reading "0" before dates are chosen is noise. */}
            {isUnpaid && (
              <div
                data-testid="unpaid-line"
                className="rounded-md border border-border bg-secondary/40 p-4 text-sm"
              >
                <p>
                  <strong>Unpaid.</strong> There is no balance: these days are not paid.
                  {workingDays !== null && !countingDays && (
                    <>
                      {" "}
                      Requested: <strong className="tabular-nums">{workingDays}</strong>
                    </>
                  )}
                </p>
                {unpaidSummary && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {unpaidSummary.takenDays} {unpaidSummary.takenDays === 1 ? "day" : "days"} taken
                    this year
                    {unpaidSummary.pendingDays > 0 &&
                      ` · ${unpaidSummary.pendingDays} awaiting a decision`}
                  </p>
                )}
                {exclusionNote && !countingDays && (
                  <p className="mt-2 text-xs text-muted-foreground">{exclusionNote}</p>
                )}
              </div>
            )}

            {blackout && (
              <p data-testid="blackout" className="text-sm text-destructive">
                Those dates fall in a blackout period ({blackout.name}), when leave can&apos;t be
                applied for. Choose dates outside it.
              </p>
            )}

            {balance && (
              <div
                data-testid="balance-line"
                className="rounded-md border border-border bg-secondary/40 p-4 text-sm"
              >
                {countingDays ? (
                  <span className="text-muted-foreground">Counting working days…</span>
                ) : workingDays === null ? (
                  <span>
                    Available: <strong className="tabular-nums">{balance.availableDays}</strong>
                  </span>
                ) : (
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Available: <strong className="tabular-nums">{balance.availableDays}</strong>
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      Requested: <strong className="tabular-nums">{workingDays}</strong>
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      Remaining: <strong className="tabular-nums">{remaining}</strong>
                    </span>
                  </span>
                )}
                {exclusionNote && !countingDays && (
                  <p data-testid="exclusion-note" className="mt-2 text-xs text-muted-foreground">
                    {exclusionNote}
                  </p>
                )}
              </div>
            )}

            {noWorkingDays && !countingDays && (
              <p data-testid="no-working-days" className="text-sm text-destructive">
                Those dates are all weekend or holiday — there&apos;s nothing to book.
              </p>
            )}

            {shortfall && (
              <p data-testid="shortfall" className="text-sm text-destructive">
                {shortfall}
              </p>
            )}
          </div>
        </Panel>
      </div>
    </form>
  );
}

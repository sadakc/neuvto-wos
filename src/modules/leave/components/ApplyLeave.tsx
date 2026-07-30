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
import { useNavigate } from "@tanstack/react-router";
import { getWorkingDays } from "@/platform/calendar";
import { getCurrentUser, type CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { getLeaveTypes, getMyBalances, submitLeave } from "../handlers";
import type { LeaveBalance } from "../contracts";

type LeaveType = { id: string; name: string };

/** Today in ISO, for the date inputs' `min`. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ApplyLeave() {
  const navigate = useNavigate();

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const [typeId, setTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const [workingDays, setWorkingDays] = useState<number | null>(null);
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
  }, []);

  const balance = useMemo(
    () => balances.find((b) => b.leaveTypeId === typeId) ?? null,
    [balances, typeId],
  );

  // Asked of the database on every date change, debounced. Deliberately not
  // computed here — see the header.
  useEffect(() => {
    if (!user || !fromDate || !toDate || toDate < fromDate) {
      setWorkingDays(null);
      return;
    }
    let cancelled = false;
    setCountingDays(true);
    const timer = setTimeout(() => {
      getWorkingDays(user.organizationId, fromDate, toDate)
        .then((d) => {
          if (!cancelled) setWorkingDays(d);
        })
        .catch(() => {
          if (!cancelled) setWorkingDays(null);
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

  const available = balance?.availableDays ?? null;
  const remaining = available !== null && workingDays !== null ? available - workingDays : null;

  // AC2. The message carries the numbers, because "insufficient balance" tells
  // an employee nothing they can act on.
  const shortfall =
    available !== null && workingDays !== null && workingDays > available
      ? `You need ${workingDays} ${workingDays === 1 ? "day" : "days"} but have ${available} available.`
      : "";

  const noWorkingDays = workingDays === 0;
  const canSubmit =
    !!typeId &&
    !!fromDate &&
    !!toDate &&
    toDate >= fromDate &&
    !!workingDays &&
    !shortfall &&
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
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="font-display text-lg font-semibold">Request sent</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your leave request is with your approver. You&apos;ll get an email when it&apos;s
            decided.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => navigate({ to: "/app/$", params: { _splat: "leave" } })}
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              See my leave
            </button>
            <button
              onClick={() => {
                setDone(false);
                setFromDate("");
                setToDate("");
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

  if (types.length === 0) {
    return (
      <div className="max-w-lg">
        <h1 className="font-display text-lg font-semibold">Apply for leave</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No leave types have been set up yet. Ask your administrator to add them.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-lg space-y-6">
      <h1 className="font-display text-lg font-semibold">Apply for leave</h1>

      <div>
        <label htmlFor="leave-type" className="block text-sm font-medium">
          Leave type
        </label>
        <select
          id="leave-type"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* AC1 — past dates are unselectable rather than rejected after the fact. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="from-date" className="block text-sm font-medium">
            First day
          </label>
          <input
            id="from-date"
            type="date"
            value={fromDate}
            min={minDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              if (toDate && e.target.value > toDate) setToDate(e.target.value);
            }}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="to-date" className="block text-sm font-medium">
            Last day
          </label>
          <input
            id="to-date"
            type="date"
            value={toDate}
            min={fromDate || minDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
      </div>

      {/* The live line the PRD asks for. Only shown once there is something true
          to say — a balance line reading "0" before dates are chosen is noise. */}
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

      <div>
        <label htmlFor="reason" className="block text-sm font-medium">
          Reason <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="reason"
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">{reason.length}/500</p>
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
        className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto"
      >
        {submitting ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}

/**
 * My leave — balances, history, and cancelling.
 *
 * Cancelling is the part that matters. The days come back from whichever bucket
 * holds them (D33), and the whole balance is re-read afterwards rather than
 * adjusted here: a number computed twice is a number that eventually disagrees
 * with itself, and this is the screen where an employee checks whether they
 * were charged correctly.
 *
 * Whether something CAN be cancelled is the database's decision, not this
 * file's. The button is hidden where it obviously does not apply, but pressing
 * it always asks, and a refusal is shown as the reason the server gave. A rule
 * duplicated here would one day disagree with leave_cancel and the employee
 * would meet that as a button that does nothing.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { cancelLeave, getApprovalTimeline, getMyBalances, getMyRequests } from "../handlers";
import { BalanceCard } from "./BalanceCard";
import type { ApprovalStep, LeaveBalance, LeaveRequest, LeaveStatus } from "../contracts";

const STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_approval", label: "Awaiting" },
  { key: "approved", label: "Approved" },
  { key: "past", label: "Past" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function MyLeave() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [filter, setFilter] = useState<FilterKey>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ApprovalStep[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState("");

  async function load() {
    const [b, r] = await Promise.all([getMyBalances(), getMyRequests()]);
    setBalances(b);
    setRequests(r);
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then(() => !cancelled && setState("ready"))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  // The timeline is a second read, so it is fetched only when a request is
  // actually opened rather than for every row in the list.
  useEffect(() => {
    const req = requests.find((r) => r.id === openId);
    if (!req?.approvalRequestId) {
      setTimeline([]);
      return;
    }
    let cancelled = false;
    getApprovalTimeline(req.approvalRequestId)
      .then((t) => !cancelled && setTimeline(t))
      .catch(() => !cancelled && setTimeline([]));
    return () => {
      cancelled = true;
    };
  }, [openId, requests]);

  async function onCancel(id: string) {
    setCancelError("");
    setCancellingId(id);
    try {
      await cancelLeave(id);
      await load(); // re-read; never adjust the balance locally
      setOpenId(null);
    } catch (e) {
      setCancelError(isAppError(e) ? e.message : "That didn't work. Please try again.");
    } finally {
      setCancellingId(null);
    }
  }

  const today = todayIso();
  const visible = requests.filter((r) => {
    if (filter === "all") return true;
    if (filter === "past") return r.toDate < today;
    return r.status === filter;
  });

  /**
   * Whether to offer the button. Deliberately generous — the server decides.
   * Anything still open and starting in the future is worth offering; getting
   * this wrong hides an action the employee is entitled to, which is worse than
   * showing one they will be told they cannot take.
   */
  const canOfferCancel = (r: LeaveRequest) =>
    (r.status === "pending_approval" || r.status === "approved") && r.fromDate > today;

  if (state === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-24 max-w-md animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load your leave just now. Try refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-lg font-semibold">My leave</h1>

        {balances.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You don&apos;t have a leave balance yet. It appears once your administrator sets up
            leave types.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <BalanceCard key={`${b.leaveTypeId}-${b.fyLabel}`} balance={b} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">History</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter requests">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                data-testid={`filter-${f.key}`}
                className={`inline-flex h-12 items-center rounded-md border px-3 text-sm ${
                  filter === f.key
                    ? "border-foreground bg-secondary font-medium"
                    : "border-border text-muted-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {requests.length === 0
              ? "You haven't requested any leave yet."
              : "Nothing matches that filter."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {visible.map((r) => {
              const open = openId === r.id;
              return (
                <li key={r.id} className="py-3">
                  <button
                    onClick={() => setOpenId(open ? null : r.id)}
                    aria-expanded={open}
                    data-testid="request-row"
                    className="flex w-full items-baseline justify-between gap-4 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.leaveTypeName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.fromDate} to {r.toDate} · {r.workingDays}{" "}
                        {r.workingDays === 1 ? "day" : "days"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {STATUS_LABEL[r.status]}
                    </span>
                  </button>

                  {open && (
                    <div
                      data-testid="request-detail"
                      className="mt-3 rounded-md bg-secondary/40 p-4"
                    >
                      {r.reason && <p className="text-sm">{r.reason}</p>}

                      <h3 className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
                        Approval
                      </h3>
                      {timeline.length === 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          No approval steps recorded.
                        </p>
                      ) : (
                        <ol className="mt-2 space-y-2">
                          {timeline.map((s) => (
                            <li key={s.level} className="flex items-baseline justify-between gap-3">
                              <span className="text-sm">
                                <span className="text-muted-foreground">Level {s.level}</span>{" "}
                                {s.approverName}
                                {s.comments && (
                                  <span className="block text-xs text-muted-foreground">
                                    “{s.comments}”
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {s.decision === "pending"
                                  ? "Waiting"
                                  : s.decision === "approved"
                                    ? "Approved"
                                    : "Declined"}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}

                      {r.rejectionReason && (
                        <p className="mt-3 text-sm text-destructive">{r.rejectionReason}</p>
                      )}

                      {canOfferCancel(r) && (
                        <div className="mt-4">
                          <button
                            onClick={() => onCancel(r.id)}
                            disabled={cancellingId === r.id}
                            data-testid="cancel-request"
                            className="inline-flex h-12 items-center justify-center rounded-md border border-destructive px-4 text-sm font-medium text-destructive disabled:opacity-50"
                          >
                            {cancellingId === r.id ? "Cancelling…" : "Cancel this request"}
                          </button>
                          <p className="mt-2 text-xs text-muted-foreground">
                            The days go straight back to your balance.
                          </p>
                        </div>
                      )}

                      {cancelError && openId === r.id && (
                        <p
                          role="alert"
                          data-testid="cancel-error"
                          className="mt-3 text-sm text-destructive"
                        >
                          {cancelError}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * My leave — balance and history.
 *
 * Deliberately modest. The full employee experience is step 7; this exists so
 * the module contributes a real page through the module contract rather than a
 * placeholder, which is the only way to know the wiring works.
 */

import { useEffect, useState } from "react";
import { getMyBalances, getMyRequests } from "../handlers";
import type { LeaveBalance, LeaveRequest } from "../contracts";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};

export default function MyLeave() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyBalances(), getMyRequests()])
      .then(([b, r]) => {
        if (cancelled) return;
        setBalances(b);
        setRequests(r);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
              <div
                key={`${b.leaveTypeId}-${b.fyLabel}`}
                className="rounded-lg border border-border p-4"
              >
                <p className="text-sm font-medium">{b.leaveTypeName}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{b.availableDays}</p>
                <p className="text-xs text-muted-foreground">
                  days available · {b.usedDays} used of {b.entitledDays + b.carryforwardDays}
                </p>
                {b.reservedDays > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {b.reservedDays} awaiting approval
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-base font-semibold">History</h2>

        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You haven&apos;t requested any leave yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {requests.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.leaveTypeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.fromDate} to {r.toDate} · {r.workingDays}{" "}
                    {r.workingDays === 1 ? "day" : "days"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

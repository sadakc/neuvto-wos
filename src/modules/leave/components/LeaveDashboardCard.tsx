/**
 * What Leave contributes to the dashboard.
 *
 * Reached through the module contract, so `src/routes/app/index.tsx` renders
 * this without importing it or knowing Leave exists. Deleting this module
 * removes the card and leaves the dashboard working — which the module-removal
 * check in CI proves.
 *
 * The PRD wants the balance above the fold, so this is deliberately the first
 * thing: numbers, then the one action most people came to take.
 */

import { useEffect, useState } from "react";
import { ModuleLink } from "@/platform/modules";
import { getCurrentUser } from "@/platform/auth";
import { getFinancialYear } from "@/platform/calendar";
import { getMyBalances, getMyRequests } from "../handlers";
import { BalanceCard } from "./BalanceCard";
import type { LeaveBalance, LeaveRequest } from "../contracts";

export default function LeaveDashboardCard() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [fyLabel, setFyLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((u) => (u ? getFinancialYear(u.organizationId) : null))
      .then((fy) => !cancelled && setFyLabel(fy))
      .catch(() => !cancelled && setFyLabel(null));

    Promise.all([getMyBalances(), getMyRequests()])
      .then(([b, r]) => {
        if (cancelled) return;
        setBalances(b);
        setRequests(r);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingCount = requests.filter((r) => r.status === "pending_approval").length;

  // The dashboard shows this financial year only. A request for next April
  // creates a balance for next year, and two unlabelled buckets for the same
  // leave type read as a duplicate — which is exactly how this was reported.
  // The full set, labelled by year, is on My leave.
  //
  // The year comes from the platform's calendar service, which knows each
  // organisation's own financial year start. Guessing it from the balances —
  // by taking the commonest label, say — is wrong the moment somebody has more
  // rows for next year than this one.
  const currentYear = fyLabel ? balances.filter((b) => b.fyLabel === fyLabel) : balances;

  const today = new Date().toISOString().slice(0, 10);
  const nextApproved = requests
    .filter((r) => r.status === "approved" && r.toDate >= today)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate))[0];

  if (state === "loading") {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  // A card that cannot load its numbers says so. It does not render zeros —
  // an employee acting on a wrong balance is worse than one seeing an error.
  if (state === "error") {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-base font-semibold">Leave</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load your balance just now.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-base font-semibold">Leave</h2>
        <ModuleLink path="leave" className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </ModuleLink>
      </div>

      {balances.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          You don&apos;t have a leave balance yet. It appears once your administrator sets up leave
          types.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {currentYear.map((b) => (
            <BalanceCard key={`${b.leaveTypeId}-${b.fyLabel}`} balance={b} />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {pendingCount > 0 && (
          <span data-testid="pending-count">{pendingCount} awaiting approval</span>
        )}
        {nextApproved && (
          <span data-testid="next-approved">Next leave {nextApproved.fromDate}</span>
        )}
      </div>

      <ModuleLink
        path="leave/apply"
        className="mt-5 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Apply for leave
      </ModuleLink>
    </section>
  );
}

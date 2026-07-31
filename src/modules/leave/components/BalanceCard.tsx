/**
 * One leave balance, with its arithmetic shown.
 *
 * The first version printed the available number and, separately, "2 used of
 * 12" and "4 awaiting approval" — and left the employee to work out why that
 * came to 6. Sada read it as a bug: eight sick days minus one used looked like
 * it should be seven, not six.
 *
 * The number was right. The presentation was not. Days are reserved when leave
 * is APPLIED for, not when it is approved (D2 — otherwise an employee can
 * overdraw by applying repeatedly before anyone decides), so `available`
 * already has the awaiting-approval days taken out. Nothing on the card said
 * so.
 *
 * A balance an employee cannot reconcile is a balance they do not trust, and
 * they will ask someone to check it — which is the cost this screen exists to
 * remove. So the subtraction is spelled out.
 *
 * The financial year is always labelled. Balances are per year, so a request
 * for next April creates a second bucket for the same leave type — which
 * without a label looks exactly like a duplicate.
 */

import type { LeaveBalance } from "../contracts";

export function BalanceCard({ balance }: { balance: LeaveBalance }) {
  const entitled = balance.entitledDays + balance.carryforwardDays;

  // Only the parts that are actually non-zero. A row of "− 0 awaiting approval"
  // is noise on the common case, where nothing is pending.
  const deductions = [
    { label: "taken", value: balance.usedDays },
    { label: "awaiting approval", value: balance.reservedDays },
    { label: "booked", value: balance.pendingDays },
  ].filter((d) => d.value > 0);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{balance.leaveTypeName}</p>
        <p className="text-xs text-muted-foreground">{balance.fyLabel}</p>
      </div>

      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {balance.availableDays}
      </p>
      <p className="text-xs text-muted-foreground">days available</p>

      <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Entitled</dt>
          <dd className="tabular-nums">{entitled}</dd>
        </div>
        {deductions.map((d) => (
          <div key={d.label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Less {d.label}</dt>
            <dd className="tabular-nums">−{d.value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 border-t border-border pt-1 font-medium">
          <dt>Available</dt>
          <dd className="tabular-nums">{balance.availableDays}</dd>
        </div>
      </dl>
    </div>
  );
}

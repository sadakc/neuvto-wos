/**
 * Claiming compensatory off (D89): leave earned by working.
 *
 * The person lists the days they worked (any day, weekdays included; a full
 * day or a half; as many as they like), says why they are owed, and attaches
 * proof if the company asks for it. It goes to their manager. Nothing is
 * credited until it is approved, and the screen says so rather than showing a
 * balance that is not real yet.
 *
 * Every rule is the database's (comp_off_submit). What this screen says about
 * the rules is said so nobody is refused for something they could have been
 * told first.
 */

import { DateField } from "@/components/shared/date-field";
import { DATE_FORMAT_MESSAGE, isIsoDate } from "@/components/shared/date-rules";
import { FilePicker } from "@/components/shared/file-picker";
import { Panel } from "@/components/shared/panel";
import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  cancelCompOff,
  getLeaveTypes,
  getMyBalances,
  getMyCompOffClaims,
  submitCompOff,
} from "../handlers";
import type { CompOffClaim, EarnedTypeRules, LeaveBalance } from "../contracts";

interface Row {
  key: number;
  date: string;
  days: number;
  note: string;
}

const STATUS: Record<
  CompOffClaim["status"],
  { label: string; tone: "warning" | "success" | "destructive" | "neutral" }
> = {
  pending_approval: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Not approved", tone: "destructive" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-09-27" → "27 Sep 2026". Read as the date it is, never through a Date
 * and a time zone; and a fixed month table, because Intl's en-GB says "Sept".
 */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

const EYEBROW = "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";

export default function CompOff() {
  const [types, setTypes] = useState<EarnedTypeRules[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [claims, setClaims] = useState<CompOffClaim[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [typeId, setTypeId] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: 1, date: "", days: 1, note: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [t, b, c] = await Promise.all([getLeaveTypes(), getMyBalances(), getMyCompOffClaims()]);
    const earned = t.filter((x) => x.kind === "earned");
    setTypes(earned);
    setBalances(b);
    setClaims(c);
    setTypeId((cur) => (earned.some((x) => x.id === cur) ? cur : (earned[0]?.id ?? "")));
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

  const type = types.find((t) => t.id === typeId) ?? null;
  // Only whole dates count; a half-typed one is said, never sent as none.
  const total = useMemo(
    () => rows.reduce((n, r) => n + (isIsoDate(r.date) ? r.days : 0), 0),
    [rows],
  );
  const halfTyped = rows.some((r) => r.date !== "" && !isIsoDate(r.date));
  const available = balances.filter((b) => types.some((t) => t.id === b.leaveTypeId));
  const today = new Date().toISOString().slice(0, 10);

  function edit(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const days = rows
        .filter((r) => isIsoDate(r.date))
        .map((r) => ({ date: r.date, days: r.days, note: r.note.trim() }));
      await submitCompOff({ leaveTypeId: type.id, days, reason: reason.trim(), proof });
      setNotice(
        `Sent for approval: ${plural(days.reduce((n, d) => n + d.days, 0))}. Nothing is credited until it's approved.`,
      );
      setRows([{ key: nextKey, date: "", days: 1, note: "" }]);
      setNextKey((k) => k + 1);
      setReason("");
      setProof(null);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw(id: string) {
    setError("");
    try {
      await cancelCompOff(id);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't work. Please try again.");
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load compensatory off just now. Try refreshing.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Compensatory off</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          Leave you earn by working a day you&apos;d otherwise have off. Claim the days you worked;
          once your manager approves, they&apos;re yours to book like any other leave.
        </p>
      </div>

      {types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Your company doesn&apos;t offer compensatory off.
        </p>
      ) : (
        <>
          {available.length > 0 && (
            <p data-testid="comp-off-available" className="text-sm">
              {available.map((b) => (
                <span key={b.leaveTypeId} className="mr-3">
                  <strong>{plural(b.availableDays)}</strong> of {b.leaveTypeName} to book
                </span>
              ))}
            </p>
          )}

          <Panel title="Claim the days you worked" testId="panel-claim">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {types.length > 1 && (
                <label className="text-sm font-medium">
                  Kind
                  <select
                    value={typeId}
                    onChange={(e) => setTypeId(e.target.value)}
                    className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {type && (
                <p data-testid="comp-off-rules" className="text-xs text-muted-foreground">
                  {type.earnedClaimWithinDays
                    ? `Claim within ${type.earnedClaimWithinDays} days of the day worked. `
                    : ""}
                  {type.earnedProofRequired ? "Proof is needed. " : ""}
                  {type.earnedExpiresAfterDays
                    ? `Credited days expire ${type.earnedExpiresAfterDays} days after approval.`
                    : "Credited days don't expire."}
                </p>
              )}

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium">Days you worked</legend>
                {rows.map((r, i) => {
                  const n = i + 1;
                  return (
                    <div
                      key={r.key}
                      className="flex flex-col gap-2 @min-[640px]/app:flex-row @min-[640px]/app:items-end"
                    >
                      <div className="text-xs text-muted-foreground @min-[640px]/app:w-48">
                        <span aria-hidden className={EYEBROW}>
                          Date
                        </span>
                        <DateField
                          label={`Day worked ${n}`}
                          max={today}
                          value={r.date}
                          invalid={r.date !== "" && !isIsoDate(r.date)}
                          onChange={(v) => edit(r.key, { date: v })}
                          className="mt-1"
                        />
                      </div>
                      <label className="text-xs text-muted-foreground @min-[640px]/app:w-36">
                        <span aria-hidden>How much</span>
                        <select
                          aria-label={`How much of day ${n}`}
                          value={String(r.days)}
                          onChange={(e) => edit(r.key, { days: Number(e.target.value) })}
                          className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                        >
                          <option value="1">Full day</option>
                          <option value="0.5">Half day</option>
                        </select>
                      </label>
                      <label className="flex-1 text-xs text-muted-foreground">
                        <span aria-hidden>Note (optional)</span>
                        <input
                          aria-label={`Note for day ${n}`}
                          value={r.note}
                          maxLength={200}
                          onChange={(e) => edit(r.key, { note: e.target.value })}
                          className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove day ${n}`}
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                          className="inline-flex h-12 items-center justify-center rounded-md border border-border px-3 text-sm"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  disabled={rows.length >= 31}
                  onClick={() => {
                    setRows((rs) => [...rs, { key: nextKey, date: "", days: 1, note: "" }]);
                    setNextKey((k) => k + 1);
                  }}
                  className="self-start text-sm font-medium underline underline-offset-4 disabled:opacity-45"
                >
                  Add another day
                </button>
              </fieldset>

              <label className="text-sm font-medium">
                Why you&apos;re owed this
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              <FilePicker
                label={type?.earnedProofRequired ? "Proof (needed)" : "Proof (optional)"}
                file={proof}
                onChange={setProof}
                accept="application/pdf,image/png,image/jpeg,image/webp"
                hint="A roster, an email, a photo of the sign-in sheet. PDF or a photo, up to 5 MB. Seen by you, your approver and the Leave Admin."
              />

              {halfTyped && (
                <p data-testid="comp-off-date-problem" className="text-sm text-destructive">
                  {DATE_FORMAT_MESSAGE}
                </p>
              )}

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

              <button
                type="submit"
                disabled={busy || total === 0 || halfTyped}
                className="inline-flex h-12 items-center justify-center self-start rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-45"
              >
                {busy ? "Sending…" : "Send for approval"}
              </button>
            </form>
          </Panel>
        </>
      )}

      {claims.length > 0 && (
        <Panel title="Your claims" testId="panel-claims">
          <ul className="-mx-4 -my-3.5 divide-y divide-border">
            {claims.map((c) => (
              <li key={c.claimId} data-testid="comp-off-claim" className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {plural(c.totalDays)} ·{" "}
                    {c.days
                      .map((d) => `${longDate(d.date)} (${d.days === 1 ? "full" : "half"})`)
                      .join(", ")}
                  </span>
                  <StatusBadge tone={STATUS[c.status].tone}>
                    {STATUS[c.status].label}
                    {c.status === "approved" && c.expiresOn
                      ? ` · expires ${longDate(c.expiresOn)}`
                      : ""}
                  </StatusBadge>
                </div>
                <p className="text-xs text-muted-foreground">{c.reason}</p>
                {c.expiredDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {plural(c.expiredDays)} expired unused.
                  </p>
                )}
                {c.status === "pending_approval" && (
                  <button
                    type="button"
                    onClick={() => void onWithdraw(c.claimId)}
                    className="self-start text-sm font-medium underline underline-offset-4"
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

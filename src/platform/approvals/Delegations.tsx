/**
 * Handing your approvals to a colleague while you are away (D92).
 *
 * Platform, not a module: every module's approvals can be handed over, all of
 * them or one module's. While a hand-over is in force the colleague sees your
 * waiting requests in their own Approvals, marked as yours, and can decide
 * them; you still can too. The database decides who may be handed approvals
 * (active, able to approve, in this company) and refuses overlaps.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  cancelDelegation,
  delegateApprovals,
  listDelegateCandidates,
  listMyDelegations,
  type Delegation,
} from "./index";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export function Delegations({
  isAdmin,
  modules,
}: {
  /** A company admin may hand over somebody else's approvals. */
  isAdmin: boolean;
  /** The modules whose approvals this workspace has. */
  modules: { key: string; name: string }[];
}) {
  const [items, setItems] = useState<Delegation[]>([]);
  const [people, setPeople] = useState<{ id: string; fullName: string }[]>([]);
  const [delegatorId, setDelegatorId] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [d, p] = await Promise.all([listMyDelegations(), listDelegateCandidates()]);
    setItems(d);
    setPeople(p);
  }

  useEffect(() => {
    load().catch(() => setError("We couldn't load who holds your approvals."));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await delegateApprovals({
        delegateId,
        fromDate,
        toDate,
        moduleKey: moduleKey || null,
        reason: reason.trim(),
        delegatorId: delegatorId || null,
      });
      const to = people.find((p) => p.id === delegateId)?.fullName ?? "They";
      const whose = delegatorId
        ? `${people.find((p) => p.id === delegatorId)?.fullName ?? "their"}'s`
        : "your";
      const scope = modules.find((m) => m.key === moduleKey)?.name;
      setNotice(
        `${to} will see and can decide ${whose} ${scope ? `${scope} ` : ""}approvals from ${longDate(fromDate)} to ${longDate(toDate)}. ${delegatorId ? "They" : "You"} still can too.`,
      );
      setDelegateId("");
      setFromDate("");
      setToDate("");
      setReason("");
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(id: string) {
    setError("");
    try {
      await cancelDelegation(id);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't work. Please try again.");
    }
  }

  const describe = (d: Delegation) => {
    const head =
      d.direction === "given"
        ? `Your approvals go to ${d.delegateName}`
        : d.direction === "received"
          ? `${d.delegatorName}'s approvals come to you`
          : `${d.delegatorName}'s approvals go to ${d.delegateName}`;
    const scope = d.moduleName ? `${d.moduleName} only` : "all of them";
    const when = d.inForce ? "in force now" : `from ${longDate(d.fromDate)}`;
    return `${head} · ${longDate(d.fromDate)} to ${longDate(d.toDate)} · ${scope} · ${when}`;
  };

  return (
    <section className="mt-12" aria-labelledby="delegation-heading">
      <h2 id="delegation-heading" className="text-card-title font-semibold tracking-card-title">
        Away? Hand your approvals over
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        A colleague sees and can decide what is waiting on you, for the dates you choose. You still
        can too. Nobody can approve their own request this way.
      </p>

      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card shadow-card">
          {items.map((d) => (
            <li
              key={d.id}
              data-testid="delegation"
              className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
            >
              <span>
                {describe(d)}
                {d.reason && (
                  <span className="block text-xs text-muted-foreground">{d.reason}</span>
                )}
              </span>
              {(d.direction === "given" || isAdmin) && (
                <button
                  type="button"
                  onClick={() => void onCancel(d.id)}
                  className="text-sm underline underline-offset-4"
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={onSubmit}
        className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-card @min-[640px]/app:grid-cols-2"
      >
        {isAdmin && (
          <label className="text-sm font-medium">
            Whose approvals
            <select
              value={delegatorId}
              onChange={(e) => setDelegatorId(e.target.value)}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Yours</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm font-medium">
          Hand them to
          <select
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
            required
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">Choose a colleague…</option>
            {people
              .filter((p) => p.id !== delegatorId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            required
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </label>
        <label className="text-sm font-medium">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </label>
        <label className="text-sm font-medium">
          Which approvals
          <select
            value={moduleKey}
            onChange={(e) => setModuleKey(e.target.value)}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">All of them</option>
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} only
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Reason (optional)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive @min-[640px]/app:col-span-2">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground @min-[640px]/app:col-span-2">
            {notice}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !delegateId || !fromDate || !toDate}
          className="inline-flex h-12 items-center justify-center justify-self-start rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Saving…" : "Hand over"}
        </button>
      </form>
    </section>
  );
}

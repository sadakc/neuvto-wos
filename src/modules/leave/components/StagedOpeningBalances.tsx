/**
 * Opening balances for people who have not joined yet (D88).
 *
 * People brought in from the master template are drafts: an employee record and
 * no account, and a leave balance belongs to an account. So what they have
 * already taken and carried over is entered here, against their record, and
 * waits. It is applied the moment they accept their invitation, by the same
 * arithmetic as the list of people who have joined.
 *
 * Checked against what their joining date entitles them to when it is entered,
 * and again when it is applied. If it no longer fits then (their joining date
 * was corrected meanwhile), nothing is applied, the invitation still goes
 * through, and the person is listed at the bottom so somebody sets it by hand.
 */

import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  getStagedOpeningBalances,
  getStagedOpeningProblems,
  stageOpeningBalance,
} from "../handlers";
import type { StagedOpeningBalance, StagedOpeningProblem } from "../contracts";

export default function StagedOpeningBalances() {
  const [rows, setRows] = useState<StagedOpeningBalance[]>([]);
  const [problems, setProblems] = useState<StagedOpeningProblem[]>([]);
  // Part of each form's key, so a reload remounts the uncontrolled inputs and
  // they never show a number the database refused (see OpeningBalances).
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  async function load() {
    const [r, p] = await Promise.all([getStagedOpeningBalances(), getStagedOpeningProblems()]);
    setRows(r);
    setProblems(p);
    setVersion((v) => v + 1);
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

  async function save(row: StagedOpeningBalance, used: number, carry: number) {
    const key = `${row.employeeRecordId}:${row.leaveTypeId}`;
    setError("");
    setNotice("");
    setSaving(key);
    try {
      await stageOpeningBalance(row.employeeRecordId, row.leaveTypeId, used, carry);
      setNotice(
        `${row.employeeName} · ${row.leaveTypeName} saved. It applies when they accept their invitation.`,
      );
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That could not be saved.");
      await load().catch(() => {});
    } finally {
      setSaving("");
    }
  }

  /** One card a person, their types inside it. */
  const people = useMemo(() => {
    const byRecord = new Map<string, StagedOpeningBalance[]>();
    for (const r of rows)
      byRecord.set(r.employeeRecordId, [...(byRecord.get(r.employeeRecordId) ?? []), r]);
    return [...byRecord.values()];
  }, [rows]);

  if (state === "loading") return <div className="h-24 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load the people who haven&apos;t joined yet. Try refreshing.
      </p>
    );
  }

  return (
    <section className="mt-8" aria-labelledby="staged-heading">
      <h3 id="staged-heading" className="text-card-title font-semibold tracking-card-title">
        Not joined yet
      </h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        People added or imported who haven&apos;t accepted their invitation. What you enter here
        waits, and is applied the moment they join.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="staged-notice" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {people.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Everybody has joined. Nobody is waiting for an opening balance.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card shadow-card">
          {people.map((types) => {
            const p = types[0];
            return (
              <li key={p.employeeRecordId} data-testid="staged-row" className="p-4">
                <span className="block text-sm font-medium">{p.employeeName}</span>
                <span className="block text-xs text-muted-foreground">
                  {p.stage === "draft" ? "Draft" : "Invited"}
                  {p.employeeCode ? ` · ${p.employeeCode}` : ""}
                  {p.joinedDate ? ` · joins ${p.joinedDate}` : " · no joining date yet"}
                </span>

                {types.map((r) => {
                  const key = `${r.employeeRecordId}:${r.leaveTypeId}`;
                  return (
                    <form
                      key={`${key}:${version}`}
                      className="mt-3 flex flex-col gap-2 @min-[640px]/app:flex-row @min-[640px]/app:items-end"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void save(r, Number(f.get("used")), Number(f.get("carry")));
                      }}
                    >
                      <span className="text-xs text-muted-foreground @min-[640px]/app:w-48">
                        {r.leaveTypeName} · {r.entitledDays} days{" "}
                        {r.joinedDate ? "from their joining date" : "for a full year"}
                        {r.staged && (
                          <span className="block font-medium text-foreground">
                            Waiting for them
                          </span>
                        )}
                      </span>
                      <label className="flex-1 text-xs text-muted-foreground">
                        Already taken this year
                        <input
                          name="used"
                          type="number"
                          min={0}
                          step="0.5"
                          defaultValue={r.usedDays}
                          className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex-1 text-xs text-muted-foreground">
                        Carried over from last year
                        <input
                          name="carry"
                          type="number"
                          min={0}
                          step="0.5"
                          defaultValue={r.carryforwardDays}
                          className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={saving === key}
                        className="inline-flex min-h-12 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        {saving === key ? "Saving…" : "Save"}
                      </button>
                    </form>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}

      {problems.length > 0 && (
        <div
          data-testid="staged-problems"
          className="mt-4 rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm"
        >
          <p className="font-medium">Couldn&apos;t be applied when they joined</p>
          <ul className="mt-1 space-y-1">
            {problems.map((p) => (
              <li key={`${p.employeeId}:${p.leaveTypeName}`}>
                {p.employeeName} · {p.leaveTypeName}:{" "}
                {p.problem === "OPENING_BALANCE_OVERDRAWN"
                  ? `${p.usedDays} days taken was more than they are entitled to once they joined, so nothing was applied.`
                  : "Leave was switched off when they joined, so nothing was applied."}{" "}
                Set their balance above.
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

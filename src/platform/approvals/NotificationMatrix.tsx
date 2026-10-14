/**
 * Who is told of what (D93): a module's approval events against the people
 * who can be told of them.
 *
 * The engine's own rules (the approver hears a request needs them, the person
 * who asked hears the outcome, both approvers hear when it moves up) are shown
 * on and locked. Everything else is off until the module's admin switches it
 * on, and then goes out as a "for your information" copy, never to somebody
 * already told. People can also be named, for every request or one
 * department's.
 *
 * Platform, not a module: a module's admin section renders this with its own
 * key, so every module's approvals are configured the same way.
 */

import { Fragment, useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { listDepartments } from "@/platform/organization";
import {
  addCustomRecipient,
  getNotificationMatrix,
  listCustomRecipients,
  listNotificationPeople,
  removeCustomRecipient,
  setNotificationRule,
  type CustomRecipient,
  type NotificationAudience,
  type NotificationCell,
  type NotificationEvent,
} from "./index";

const EVENTS: { key: NotificationEvent; label: string; sentence: string }[] = [
  { key: "approval.submitted", label: "raised", sentence: "is raised" },
  { key: "approval.completed", label: "approved or rejected", sentence: "is approved or rejected" },
  { key: "approval.escalated", label: "moved up", sentence: "moves up to somebody else" },
];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function NotificationMatrix({
  moduleKey,
  adminLabel,
}: {
  moduleKey: string;
  /** What this module calls its admins: "Leave Admins". */
  adminLabel: string;
}) {
  const [cells, setCells] = useState<NotificationCell[]>([]);
  const [custom, setCustom] = useState<CustomRecipient[]>([]);
  const [people, setPeople] = useState<{ id: string; fullName: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("");
  const [when, setWhen] = useState("");
  const [dept, setDept] = useState("");

  const AUDIENCES: { key: NotificationAudience; label: string }[] = [
    { key: "approver", label: "the approver" },
    { key: "requester", label: "the person who asked" },
    { key: "requester_manager", label: "their manager" },
    { key: "module_admins", label: adminLabel },
  ];

  async function load() {
    const [m, c] = await Promise.all([
      getNotificationMatrix(moduleKey),
      listCustomRecipients(moduleKey),
    ]);
    setCells(m);
    setCustom(c);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getNotificationMatrix(moduleKey).then((m) => !cancelled && setCells(m)),
      listCustomRecipients(moduleKey).then((c) => !cancelled && setCustom(c)),
      listNotificationPeople(moduleKey).then((p) => !cancelled && setPeople(p)),
      listDepartments()
        .then((d) => !cancelled && setDepartments(d.map((x) => ({ id: x.id, name: x.name }))))
        .catch(() => {}),
    ])
      .then(() => !cancelled && setState("ready"))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load who is told of what just now. Try refreshing.
      </p>
    );
  }

  const entities = [...new Map(cells.map((c) => [c.entityType, c.entityLabel])).entries()];
  const find = (entityType: string, eventKey: string, audience: string) =>
    cells.find(
      (c) => c.entityType === entityType && c.eventKey === eventKey && c.audience === audience,
    );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground">
        Emails are sent from the address Neuvto&apos;s platform administrator set up for your
        company. What is ticked and locked is always sent.
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {entities.map(([entityType, label]) => (
        <div key={entityType} className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="mb-2 text-left font-medium">{capital(label)}</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-normal">When it is</th>
                {AUDIENCES.map((a) => (
                  <th key={a.key} className="px-2 py-2 font-normal whitespace-nowrap">
                    {capital(a.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {EVENTS.map((e) => (
                <tr key={e.key}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {capital(e.label)}
                  </th>
                  {AUDIENCES.map((a) => {
                    const c = find(entityType, e.key, a.key);
                    if (!c) {
                      return (
                        <td key={a.key} className="px-2 py-2 text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const name = `${capital(label)} ${e.label}: ${a.label}${c.mandatory ? " (always)" : ""}`;
                    return (
                      <td key={a.key} className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={name}
                          checked={c.enabled}
                          disabled={c.mandatory || busy}
                          onChange={() =>
                            void run(() =>
                              setNotificationRule(c.entityType, c.eventKey, c.audience, !c.enabled),
                            )
                          }
                          className="size-5 accent-primary disabled:opacity-60"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <section>
        <h3 className="text-sm font-medium">People told as well</h3>
        {custom.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nobody named yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card shadow-card">
            {custom.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span>
                  {c.personName} is told when a {c.entityLabel}{" "}
                  {EVENTS.find((e) => e.key === c.eventKey)?.sentence ?? c.eventKey} ·{" "}
                  {c.departmentName ? `${c.departmentName} only` : "every department"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => removeCustomRecipient(c.id))}
                  className="text-sm underline underline-offset-4"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-3 grid gap-3 @min-[640px]/app:grid-cols-4 @min-[640px]/app:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const [entityType, eventKey] = when.split("|");
            void run(async () => {
              await addCustomRecipient(
                entityType,
                eventKey as NotificationEvent,
                who,
                dept || null,
              );
              setWho("");
            });
          }}
        >
          <label className="text-xs text-muted-foreground">
            Also tell
            <select
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">Choose somebody…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            When
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">Choose when…</option>
              {entities.map(([entityType, label]) => (
                <Fragment key={entityType}>
                  {EVENTS.map((e) => (
                    <option key={e.key} value={`${entityType}|${e.key}`}>
                      A {label} {e.sentence}
                    </option>
                  ))}
                </Fragment>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            For
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">Every department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} only
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || !who || !when}
            className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-45"
          >
            Add
          </button>
        </form>
      </section>
    </div>
  );
}

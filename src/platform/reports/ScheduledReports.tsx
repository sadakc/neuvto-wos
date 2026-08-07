/**
 * Scheduled reports, as an administrator sets them up.
 *
 * Sada asked for a report that arrives without anybody opening the product —
 * weekly covering "the past week and the upcoming week", monthly "by the end of
 * the month", sent "to the admin's email, to the CEO's email".
 *
 * The form states in plain words what will arrive and when, because the one
 * thing an admin cannot check afterwards is whether they configured the thing
 * they meant. A schedule that is wrong looks identical to one that is right
 * until the wrong week's email lands.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  CADENCES,
  MAX_RECIPIENTS,
  ScheduleInput,
  WEEKDAYS,
  describeRecipients,
  describeSchedule,
  listReportDefinitions,
  listSchedules,
  ordinal,
  removeSchedule,
  saveSchedule,
  type Cadence,
  type ReportDefinition,
  type ReportSchedule,
} from "./schedules";

interface Draft {
  id: string | null;
  reportKey: string;
  cadence: Cadence;
  dayOfWeek: number;
  dayOfMonth: number;
  recipients: string;
  isActive: boolean;
}

function emptyDraft(reportKey: string): Draft {
  return {
    id: null,
    reportKey,
    cadence: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 31,
    recipients: "",
    isActive: true,
  };
}

/** One address per line, or comma-separated — whichever somebody pastes. */
function parseRecipients(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ScheduledReports() {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<ReportSchedule | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listReportDefinitions(), listSchedules()])
      .then(([defs, list]) => {
        if (cancelled) return;
        setDefinitions(defs);
        setSchedules(list);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    setSchedules(await listSchedules());
  }

  async function onSave() {
    if (!draft) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const parsed = ScheduleInput.parse({
        id: draft.id,
        reportKey: draft.reportKey,
        cadence: draft.cadence,
        dayOfWeek: draft.cadence === "weekly" ? draft.dayOfWeek : null,
        dayOfMonth: draft.cadence === "monthly" ? draft.dayOfMonth : null,
        recipients: parseRecipients(draft.recipients),
        isActive: draft.isActive,
      });
      await saveSchedule(parsed);
      setNotice(`Saved. ${describeSchedule(parsed)}.`);
      setDraft(null);
      await reload();
    } catch (err) {
      setError(message(err, "That schedule couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(s: ReportSchedule) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await removeSchedule(s.id);
      setRemoving(null);
      setNotice("That schedule was removed. No more emails will be sent for it.");
      await reload();
    } catch (err) {
      setError(message(err, "That schedule couldn't be removed."));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your scheduled reports just now. Try refreshing.
      </p>
    );
  }

  // Nothing in this workspace can be emailed — every module that reports is off.
  // Not an error, and not a form with an empty dropdown.
  if (definitions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        None of the modules in this workspace can send a report by email yet.
      </p>
    );
  }

  const titleOf = (key: string) => definitions.find((d) => d.key === key)?.title ?? key;

  return (
    <div>
      {schedules.length === 0 && !draft && (
        <p className="mb-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing is scheduled. Reports are here whenever somebody signs in — a schedule sends one
          by email instead, to anybody you name, whether or not they have an account.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="schedules-error" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          data-testid="schedules-notice"
          className="mb-4 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}

      {schedules.length > 0 && (
        <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
          {schedules.map((s) => (
            <li key={s.id} data-testid="schedule-row" className="p-4">
              <div className="flex items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {titleOf(s.reportKey)}
                    {!s.isActive && (
                      <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs font-normal text-muted-foreground">
                        Paused
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {describeSchedule(s)}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    To {describeRecipients(s.recipients)}
                    {/* Dated in the workspace's own timezone, which is what
                        decided the send — the browser's would disagree for
                        five and a half hours of every day (D9). */}
                    {s.lastRunOn && ` · last sent ${s.lastRunOn}`}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    onClick={() => {
                      setError("");
                      setNotice("");
                      setRemoving(null);
                      setDraft({
                        id: s.id,
                        reportKey: s.reportKey,
                        cadence: s.cadence,
                        dayOfWeek: s.dayOfWeek ?? 1,
                        dayOfMonth: s.dayOfMonth ?? 31,
                        recipients: s.recipients.join("\n"),
                        isActive: s.isActive,
                      });
                    }}
                    data-testid="edit-schedule"
                    className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      setError("");
                      setDraft(null);
                      setRemoving(s);
                    }}
                    data-testid="remove-schedule"
                    className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                  >
                    Remove
                  </button>
                </span>
              </div>

              {removing?.id === s.id && (
                <div
                  data-testid="remove-schedule-confirm"
                  className="mt-3 rounded-md border border-border bg-secondary/30 p-4"
                >
                  <p className="text-sm font-medium">Stop sending this report?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {describeRecipients(s.recipients)} will stop receiving it. Nothing already sent
                    is affected, and the report itself stays on this page.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onRemove(s)}
                      disabled={busy}
                      data-testid="confirm-remove-schedule"
                      className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? "Removing…" : "Remove"}
                    </button>
                    <button
                      onClick={() => setRemoving(null)}
                      className="inline-flex min-h-12 items-center rounded-md border border-border px-4 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!draft ? (
        <button
          onClick={() => {
            setError("");
            setNotice("");
            setRemoving(null);
            setDraft(emptyDraft(definitions[0].key));
          }}
          data-testid="add-schedule"
          className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm font-medium"
        >
          Schedule a report
        </button>
      ) : (
        <div data-testid="schedule-form" className="rounded-lg border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Report</span>
              <select
                value={draft.reportKey}
                onChange={(e) => setDraft({ ...draft, reportKey: e.target.value })}
                data-testid="schedule-report"
                className="h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {definitions.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">How often</span>
              <select
                value={draft.cadence}
                onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Cadence })}
                data-testid="schedule-cadence"
                className="h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {c === "weekly" ? "Every week" : "Every month"}
                  </option>
                ))}
              </select>
            </label>

            {draft.cadence === "weekly" ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Which day</span>
                <select
                  value={draft.dayOfWeek}
                  onChange={(e) => setDraft({ ...draft, dayOfWeek: Number(e.target.value) })}
                  data-testid="schedule-day-of-week"
                  className="h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Which day</span>
                <select
                  value={draft.dayOfMonth}
                  onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })}
                  data-testid="schedule-day-of-month"
                  className="h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {/* 31 is the only one that does not mean what it says, and
                          it is the one most people want. Short months are
                          clamped rather than skipped. */}
                      {d === 31 ? "The last day of the month" : `The ${ordinal(d)}`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Send to</span>
              <textarea
                value={draft.recipients}
                onChange={(e) => {
                  setDraft({ ...draft, recipients: e.target.value });
                  setError("");
                }}
                rows={3}
                placeholder={"ceo@yourcompany.com\nhr@yourcompany.com"}
                data-testid="schedule-recipients"
                className="w-full rounded-md border border-border bg-background p-3 text-sm"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                One address per line, up to {MAX_RECIPIENTS}. They do not need a Neuvto account.
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                data-testid="schedule-active"
                className="size-4"
              />
              <span>Send it</span>
            </label>
          </div>

          {/* The whole point of the form, in one sentence. */}
          <p data-testid="schedule-summary" className="mt-4 text-sm text-muted-foreground">
            {describeSchedule({
              cadence: draft.cadence,
              dayOfWeek: draft.cadence === "weekly" ? draft.dayOfWeek : null,
              dayOfMonth: draft.cadence === "monthly" ? draft.dayOfMonth : null,
            })}
            , to {describeRecipients(parseRecipients(draft.recipients))}.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={onSave}
              disabled={busy || parseRecipients(draft.recipients).length === 0}
              data-testid="save-schedule"
              className="inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setError("");
              }}
              className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A Zod message is written for the reader; anything else is already translated. */
function message(err: unknown, fallback: string): string {
  if (isAppError(err)) return err.message;
  if (err instanceof Error && "issues" in err) {
    return (err as { issues: { message: string }[] }).issues[0].message;
  }
  return fallback;
}

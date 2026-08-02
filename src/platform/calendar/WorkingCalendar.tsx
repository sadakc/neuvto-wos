/**
 * The organisation's working calendar, as an administrator sets it.
 *
 * Shared by Settings and the setup wizard. It was written twice for about ten
 * minutes and that was already enough to notice: a weekend picker whose rules
 * live in two files is a weekend that eventually means two different things,
 * and every balance in the product is counted against it.
 *
 * Sada asked for six-day weeks explicitly. That is why this is a per-day array
 * and not an "exclude weekends" boolean — a Gulf customer on Friday/Saturday
 * and an Indian firm working six days are both ordinary, and neither is an
 * exception to the other.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { getFinancialYear, getOrgSettings, saveOrgSettings, type OrgSettings } from ".";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function WorkingCalendar({
  organizationId,
  onSaved,
}: {
  organizationId: string;
  onSaved?: () => void;
}) {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [financialYear, setFinancialYear] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getOrgSettings();
        if (cancelled) return;
        if (!s) {
          setState("error");
          return;
        }
        setSettings(s);
        // Not worth failing the form for — it is a label, not an input.
        await getFinancialYear(organizationId)
          .then((fy) => !cancelled && setFinancialYear(fy))
          .catch(() => {});
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  function update<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  function toggleWeekendDay(day: number) {
    if (!settings) return;
    update(
      "weekendDays",
      settings.weekendDays.includes(day)
        ? settings.weekendDays.filter((d) => d !== day)
        : [...settings.weekendDays, day].sort((a, b) => a - b),
    );
  }

  async function onSave() {
    if (!settings) return;
    setError("");
    setSaving(true);
    try {
      await saveOrgSettings(organizationId, settings);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your calendar configuration just now. Try refreshing.
      </p>
    );
  }

  const s = settings!;
  const workingDays = DAYS.filter((_, i) => !s.weekendDays.includes(i)).length;

  /**
   * What a long weekend actually costs under the days currently selected.
   *
   * This read "Friday to Monday costs 2 days rather than 4" — hardcoded, and
   * true only for a Saturday/Sunday week. Sada switched Acme to a six-day week
   * (Sunday only) and the line went on claiming 2 when the answer is 3: Friday,
   * Saturday and Monday are all worked, and only Sunday is not.
   *
   * Counted here rather than stated, over the same four calendar days the
   * sentence names — Friday, Saturday, Sunday, Monday, which are indices
   * 5, 6, 0, 1. An administrator changing the week is the one person who most
   * needs this number to be theirs.
   */
  const FRI_TO_MON = [5, 6, 0, 1];
  const longWeekendCost = FRI_TO_MON.filter((i) => !s.weekendDays.includes(i)).length;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-medium">The working week</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Which days are <strong>not</strong> worked. A six-day week has only Sunday selected; a
          five-day week has Saturday and Sunday.
        </p>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Non-working days">
          {DAYS.map((d, i) => {
            const off = s.weekendDays.includes(i);
            return (
              <button
                key={d}
                onClick={() => toggleWeekendDay(i)}
                aria-pressed={off}
                data-testid={`weekend-${i}`}
                className={`inline-flex h-12 items-center rounded-md border px-3 text-sm ${
                  off
                    ? "border-foreground bg-secondary font-medium"
                    : "border-border text-muted-foreground"
                }`}
              >
                {d.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {workingDays === 0
            ? "A working week needs at least one working day."
            : `${workingDays}-day working week`}
        </p>

        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.excludeWeekends}
            onChange={(e) => update("excludeWeekends", e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">
              Don&apos;t count non-working days as leave
            </span>
            <span className="block text-xs text-muted-foreground">
              {longWeekendCost === 4
                ? "Nothing is excluded — every day of the week is worked"
                : `Friday to Monday costs ${longWeekendCost} ${
                    longWeekendCost === 1 ? "day" : "days"
                  } rather than 4`}
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.excludeHolidays}
            onChange={(e) => update("excludeHolidays", e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">Don&apos;t count holidays as leave</span>
            <span className="block text-xs text-muted-foreground">
              A request spanning a configured holiday doesn&apos;t spend a day on it
            </span>
          </span>
        </label>
      </section>

      <section>
        <h3 className="text-sm font-medium">The leave year</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fy-month" className="block text-sm font-medium">
              Financial year starts
            </label>
            <div className="mt-2 flex gap-2">
              <select
                id="fy-month"
                value={s.fyStartMonth}
                onChange={(e) => update("fyStartMonth", Number(e.target.value))}
                className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                aria-label="Day of month"
                type="number"
                min={1}
                max={31}
                value={s.fyStartDay}
                onChange={(e) => update("fyStartDay", Number(e.target.value))}
                className="h-12 w-20 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Drives entitlement and the annual reset
              {financialYear && ` · currently ${financialYear}`}
            </p>
          </div>

          {/* D34, in the customer's hands. */}
          <div>
            <label htmlFor="fy-open" className="block text-sm font-medium">
              Next year opens
            </label>
            <select
              id="fy-open"
              value={s.nextFyOpensMonthsBefore}
              onChange={(e) => update("nextFyOpensMonthsBefore", Number(e.target.value))}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value={0}>Not until it starts</option>
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m} month{m === 1 ? "" : "s"} before
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              How early people can book into next year
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium">Requests</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="notice" className="block text-sm font-medium">
              Minimum notice
            </label>
            <input
              id="notice"
              type="number"
              min={0}
              max={365}
              value={s.defaultMinNoticeDays}
              onChange={(e) => update("defaultMinNoticeDays", Number(e.target.value))}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Days. A leave type can require more
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium">Time zone</span>
            <p className="mt-2 flex h-12 items-center text-sm tabular-nums">{s.timezone}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every date check resolves here, never against the server clock
            </p>
          </div>
        </div>

        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.allowRetroactive}
            onChange={(e) => update("allowRetroactive", e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">Allow backdated requests</span>
            <span className="block text-xs text-muted-foreground">
              Lets somebody record leave they have already taken
            </span>
          </span>
        </label>
      </section>

      {error && (
        <p role="alert" data-testid="settings-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onSave}
          disabled={saving || workingDays === 0}
          data-testid="save-settings"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>
    </div>
  );
}

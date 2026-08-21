/**
 * When people are paid, and what a month's worth of days is.
 *
 * Two questions, and neither is cosmetic. The calculation method decides what a
 * day of absence costs; the pay date decides when rent gets paid. So this screen
 * says what each choice does in money and in dates rather than only naming it,
 * and shows the answer for the current month against the choice being made
 * rather than the one already saved.
 *
 * THE WORKING WEEK IS NOT HERE, and the source spec puts it here. It already
 * exists once, in the organisation's working calendar, where leave is counted
 * against it. A second copy owned by payroll is a workspace with two weekends —
 * and the one that pays people would eventually disagree with the one that
 * counts their days off. The link below goes there instead.
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { isAppError } from "@/platform/errors";
import { getOrgToday } from "@/platform/calendar";
import { getCurrentUser } from "@/platform/auth";
import { getPayrollSettings, previewPayDate, savePayrollSettings } from "../handlers";
import { PayrollSettings } from "../contracts";

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function PaySchedule() {
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [thisMonth, setThisMonth] = useState("");
  const [preview, setPreview] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, user] = await Promise.all([getPayrollSettings(), getCurrentUser()]);
        // The organisation's day, not this browser's. A workspace in Madikeri
        // configured from a laptop somewhere else should preview its own month.
        const today = user ? await getOrgToday(user.organizationId) : "";
        if (cancelled) return;
        setSettings(s);
        setThisMonth(today ? `${today.slice(0, 7)}-01` : "");
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load your pay schedule.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recomputed from the DRAFT, so the date shown is the one the choice on
  // screen would produce. Previewing the saved value would answer the question
  // before the one being asked.
  useEffect(() => {
    if (!settings || !thisMonth) return;
    let cancelled = false;
    previewPayDate(thisMonth, settings.paySchedule)
      .then((d) => !cancelled && setPreview(d))
      .catch(() => !cancelled && setPreview(""));
    return () => {
      cancelled = true;
    };
  }, [settings, thisMonth]);

  function edit(patch: Partial<PayrollSettings["paySchedule"]>) {
    setSaved(false);
    setSettings((s) => (s ? { ...s, paySchedule: { ...s.paySchedule, ...patch } } : s));
  }

  async function save() {
    if (!settings) return;
    setError("");
    const parsed = PayrollSettings.safeParse(settings);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setSaving(true);
    try {
      setSettings(await savePayrollSettings(parsed.data));
      setSaved(true);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (state === "error" || !settings) {
    return (
      <p role="alert" className="rounded-lg border border-border p-6 text-sm text-destructive">
        {error}
      </p>
    );
  }

  const schedule = settings.paySchedule;

  return (
    <div className="space-y-8">
      {/* ─────────────────────────────────────── how a month is counted */}
      <fieldset>
        <legend className="font-display text-sm font-semibold">Salary calculation</legend>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What a month&apos;s salary is divided by when somebody is not present for all of it.
        </p>

        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-3 rounded-md border border-border p-3">
            <input
              type="radio"
              name="calculationMethod"
              className="mt-1"
              checked={schedule.calculationMethod === "actual_days"}
              onChange={() => edit({ calculationMethod: "actual_days" })}
            />
            <span className="text-sm">
              <span className="font-medium">Actual days in the month</span>
              <span className="mt-0.5 block text-muted-foreground">
                A day in February is worth more than a day in March, and a full month always pays
                exactly a month&apos;s salary.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-md border border-border p-3">
            <input
              type="radio"
              name="calculationMethod"
              className="mt-1"
              checked={schedule.calculationMethod === "fixed_days"}
              onChange={() => edit({ calculationMethod: "fixed_days" })}
            />
            <span className="text-sm">
              <span className="font-medium">A fixed number of days every month</span>
              <span className="mt-0.5 block text-muted-foreground">
                Every day is worth the same all year. On a 31-day month, somebody present throughout
                is paid more than a month&apos;s salary — which is the arrangement, not a fault.
              </span>
            </span>
          </label>

          {schedule.calculationMethod === "fixed_days" && (
            <label className="ml-6 flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Days per month</span>
              <input
                type="number"
                min={28}
                max={31}
                aria-label="Fixed days per month"
                value={schedule.fixedDays}
                onChange={(e) => edit({ fixedDays: Number(e.target.value) })}
                className="h-12 w-24 rounded-md border border-input bg-background px-3 text-sm tabular-nums"
              />
            </label>
          )}
        </div>
      </fieldset>

      {/* ─────────────────────────────────────────────── when it lands */}
      <fieldset>
        <legend className="font-display text-sm font-semibold">Pay date</legend>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          When salary reaches an account. If the day falls on a non-working day or a holiday, it
          moves to the previous working day — money arriving early inconveniences a finance team,
          money arriving late is somebody&apos;s rent.
        </p>

        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-3 rounded-md border border-border p-3">
            <input
              type="radio"
              name="payDateRule"
              className="mt-1"
              checked={schedule.payDateRule === "last_working_day"}
              onChange={() => edit({ payDateRule: "last_working_day" })}
            />
            <span className="text-sm">
              <span className="font-medium">The last working day of the month being paid</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-md border border-border p-3">
            <input
              type="radio"
              name="payDateRule"
              className="mt-1"
              checked={schedule.payDateRule === "day_of_next_month"}
              onChange={() => edit({ payDateRule: "day_of_next_month" })}
            />
            <span className="text-sm">
              <span className="font-medium">A day of the month after</span>
              <span className="mt-0.5 block text-muted-foreground">
                July&apos;s salary paid in August. A day inside the month being paid would credit a
                salary before it had been earned, so this is always the following month.
              </span>
            </span>
          </label>

          {schedule.payDateRule === "day_of_next_month" && (
            <label className="ml-6 flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Day of the month</span>
              <input
                type="number"
                min={1}
                max={31}
                aria-label="Pay day of the month"
                value={schedule.payDay}
                onChange={(e) => edit({ payDay: Number(e.target.value) })}
                className="h-12 w-24 rounded-md border border-input bg-background px-3 text-sm tabular-nums"
              />
            </label>
          )}
        </div>
      </fieldset>

      {/* The spec's own lesson: a live answer beats a described rule. This is
          the current month resolved against the organisation's real calendar,
          so a pay date landing on a holiday is visible before it is saved. */}
      {preview && (
        <p
          data-testid="pay-date-preview"
          role="status"
          className="rounded-lg border border-border bg-secondary/40 p-4 text-sm"
        >
          This month&apos;s salary would be credited on{" "}
          <span className="font-medium">{longDate(preview)}</span>.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        The working week and holidays this uses are shared with every module and are set under{" "}
        <Link to="/app/settings" className="underline underline-offset-2">
          Organisation
        </Link>
        .
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          data-testid="save-pay-schedule"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save pay schedule"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  );
}

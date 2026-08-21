/**
 * What an employee is shown of their own pay.
 *
 * Sada's rule for the employee view is a short one — the payslip, when the money
 * lands, nothing else — with the administrator deciding what is shown. This is
 * that decision, and the screen is careful to say which of these switches is a
 * permission and which is a preference, because they look identical and are not.
 *
 * `payslipsVisible` is enforced by the database. The policy on `pay_run_lines`
 * reads this setting itself (20260824100000), so switching it off stops the
 * figures reaching the browser rather than stopping a component drawing them.
 * Without that it would be worth nothing: `getRunLines` selects straight from
 * the table, and anybody with a console open would still have every number.
 *
 * The other two are presentation, and are labelled as presentation. They decide
 * how much of an employee's own payslip is laid out for them — their own PF,
 * their own ESI — which is a question of detail on a screen, not of who may see
 * what. Dressing that as a security control would teach an administrator to
 * trust a switch that protects nothing.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { getPayrollSettings, savePayrollSettings } from "../handlers";
import { PayrollSettings } from "../contracts";

/**
 * Only the switches. The portal block also carries a banner and a contact,
 * which are text and not toggles — typing this as `keyof` would let one of them
 * be listed below and rendered as a checkbox holding a sentence.
 */
type ToggleKey = {
  [K in keyof PayrollSettings["employeePortal"]]: PayrollSettings["employeePortal"][K] extends boolean
    ? K
    : never;
}[keyof PayrollSettings["employeePortal"]];

interface Toggle {
  key: ToggleKey;
  label: string;
  description: string;
  /** True when switching it off stops the data, not only the drawing of it. */
  enforced: boolean;
}

const TOGGLES: Toggle[] = [
  {
    key: "payslipsVisible",
    label: "Payslips",
    description:
      "Whether people can open their own payslips at all. Switching this off refuses the figures in the database, not just on the screen.",
    enforced: true,
  },
  {
    key: "showPayDate",
    label: "The date salary is credited",
    description:
      "Whether the payslip says when the money lands. Derived from your pay schedule, so it is the same date for everybody.",
    enforced: false,
  },
  {
    key: "showStatutoryBreakdown",
    label: "The statutory breakdown",
    description:
      "Whether provident fund, employee state insurance and professional tax are itemised, or only the deduction total is shown. Their own figures either way.",
    enforced: false,
  },
];

export default function EmployeePortal() {
  const [config, setConfig] = useState<PayrollSettings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPayrollSettings()
      .then((s) => {
        if (cancelled) return;
        setConfig(s);
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load these config.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: Toggle["key"], value: boolean) {
    if (!config) return;
    const next: PayrollSettings = {
      ...config,
      employeePortal: { ...config.employeePortal, [key]: value },
    };
    setConfig(next);
    setSaved(false);
    setError("");
    setSaving(true);
    try {
      // Saved on change rather than behind a button. Each of these is one
      // decision on its own, and a switch that looks flipped but is not saved is
      // an administrator believing payslips are hidden when they are not.
      setConfig(await savePayrollSettings(next));
      setSaved(true);
    } catch (e) {
      setConfig(config); // put it back; the server did not take it
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /** Text fields are edited locally and saved on a button. See the note above. */
  function draft(patch: Partial<PayrollSettings["employeePortal"]>) {
    setSaved(false);
    setConfig((c) => (c ? { ...c, employeePortal: { ...c.employeePortal, ...patch } } : c));
  }

  async function saveDraft() {
    if (!config) return;
    setError("");
    const parsed = PayrollSettings.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setSaving(true);
    try {
      setConfig(await savePayrollSettings(parsed.data));
      setSaved(true);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <div className="h-48 animate-pulse rounded-lg bg-muted" />;

  if (state === "error" || !config) {
    return (
      <p role="alert" className="rounded-lg border border-border p-6 text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {TOGGLES.map((t) => {
          const on = config.employeePortal[t.key];
          return (
            <li key={t.key} className="flex items-start justify-between gap-4 p-4">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t.label}</span>
                  {/* Named, not implied. An administrator deciding what to rely
                      on needs to know which of these the database will back. */}
                  <span
                    data-testid={`enforcement-${t.key}`}
                    className="rounded border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground"
                  >
                    {t.enforced ? "refused in the database" : "display only"}
                  </span>
                </span>
                <span className="mt-1 block max-w-prose text-sm text-muted-foreground">
                  {t.description}
                </span>
              </span>

              <label className="flex shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={saving}
                  aria-label={t.label}
                  data-testid={`toggle-${t.key}`}
                  onChange={(e) => toggle(t.key, e.target.checked)}
                  className="h-5 w-5"
                />
                <span className="text-muted-foreground">{on ? "Shown" : "Hidden"}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* ─────────────────────────────────────── the announcement and who to ask
          Saved behind a button rather than on change, unlike the switches
          above: a half-typed sentence saved on every keystroke would put a
          half-typed sentence in front of everybody in the workspace. */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">What the payslip screen says</p>

        <label className="block text-sm">
          <span className="text-muted-foreground">Announcement</span>
          <textarea
            rows={2}
            value={config.employeePortal.bannerMessage}
            onChange={(e) => draft({ bannerMessage: e.target.value })}
            placeholder="Salary for March will be credited a day late."
            aria-label="Announcement"
            className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted-foreground">Shown until</span>
          <input
            type="date"
            value={config.employeePortal.bannerUntil}
            onChange={(e) => draft({ bannerUntil: e.target.value })}
            aria-label="Shown until"
            className="mt-1 h-12 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Leave this empty and the notice stays until somebody takes it down — which is how
            &ldquo;salary is late this month&rdquo; ends up on screen in March.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-muted-foreground">Who to ask about a payslip</span>
            <input
              value={config.employeePortal.contactName}
              onChange={(e) => draft({ contactName: e.target.value })}
              aria-label="Contact name"
              className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Their email</span>
            <input
              type="email"
              value={config.employeePortal.contactEmail}
              onChange={(e) => draft({ contactEmail: e.target.value })}
              aria-label="Contact email"
              className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={saveDraft}
          disabled={saving}
          data-testid="save-portal-message"
          className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
        >
          Save announcement
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm text-muted-foreground">Saved.</p>}
    </div>
  );
}

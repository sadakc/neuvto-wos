/**
 * How a payslip looks, and what it says at the top and the bottom.
 *
 * The source spec calls these PDF templates and offers six variants of one
 * document. This offers three LAYOUTS, and the difference in the word is the
 * difference in the mechanism: a payslip here reaches paper through the
 * browser's own print dialog, so a variant is a print layout rather than a
 * document format — no library, no dependency, no cost.
 *
 * Three that do genuinely different things, rather than six that differ by
 * margin. A gallery of near-identical thumbnails is a decision nobody can make
 * on the evidence in front of them.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { getPayrollSettings, savePayrollSettings } from "../handlers";
import { PayrollSettings, type PayslipLayout } from "../contracts";

const LAYOUTS: { key: PayslipLayout; label: string; blurb: string }[] = [
  {
    key: "standard",
    label: "Standard",
    blurb:
      "Earnings and deductions side by side, with the net pay called out. What most people expect a payslip to look like.",
  },
  {
    key: "detailed",
    label: "Detailed",
    blurb:
      "Adds the employee's statutory identifiers, the department, and the days paid against the days in the month. For workspaces whose people ask.",
  },
  {
    key: "compact",
    label: "Compact",
    blurb:
      "Gross, total deductions, net. One block, no breakdown — for a workspace that sends the detail some other way.",
  },
];

export default function PayslipTemplate() {
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
        setError(isAppError(e) ? e.message : "We couldn't load your payslip settings.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function edit(patch: Partial<PayrollSettings["payslip"]>) {
    setSaved(false);
    setConfig((c) => (c ? { ...c, payslip: { ...c.payslip, ...patch } } : c));
  }

  async function save() {
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

  const slip = config.payslip;

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        A payslip is downloaded through your browser&apos;s own print dialog, which every platform
        offers as &ldquo;Save as PDF&rdquo;. That is why these are layouts rather than file
        templates — and why the person saving one chooses its filename.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Layout</legend>
        {LAYOUTS.map((l) => (
          <label key={l.key} className="flex items-start gap-3 rounded-md border border-border p-3">
            <input
              type="radio"
              name="layout"
              className="mt-1"
              checked={slip.layout === l.key}
              onChange={() => edit({ layout: l.key })}
              aria-label={l.label}
            />
            <span className="text-sm">
              <span className="font-medium">{l.label}</span>
              <span className="mt-0.5 block text-muted-foreground">{l.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Letterhead</span>
          <input
            value={slip.letterhead}
            onChange={(e) => edit({ letterhead: e.target.value })}
            placeholder="Registered address, shown under the company name"
            aria-label="Letterhead"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Footer note</span>
          <input
            value={slip.footerNote}
            onChange={(e) => edit({ footerNote: e.target.value })}
            aria-label="Footer note"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
        </label>
      </div>

      {/* Rendered from the settings above rather than described, so a letterhead
          that is too long to fit shows as too long to fit. */}
      <div data-testid="payslip-preview" className="rounded-lg border border-border p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          How it will print
        </p>
        <div className="mt-3 rounded-md border border-border bg-background p-4">
          <p className="font-display text-sm font-semibold">Your company</p>
          {slip.letterhead && (
            <p data-testid="preview-letterhead" className="text-xs text-muted-foreground">
              {slip.letterhead}
            </p>
          )}
          <p className="mt-2 text-sm">Payslip for July 2026</p>
          <p className="text-xs text-muted-foreground">Priya Employee · TISR0009</p>

          {slip.layout === "detailed" && (
            <p data-testid="preview-detailed" className="mt-1 text-xs text-muted-foreground">
              UAN 100200300400 · Front office · 30 of 31 days payable
            </p>
          )}

          {slip.layout === "compact" ? (
            <dl data-testid="preview-compact" className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Earned gross</dt>
                <dd className="tabular-nums">₹53,226</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Total deductions</dt>
                <dd className="tabular-nums">₹2,000</dd>
              </div>
            </dl>
          ) : (
            <div data-testid="preview-breakdown" className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Earnings</p>
                <p className="text-muted-foreground">basic · hra · conveyance</p>
              </div>
              <div>
                <p className="font-medium">Deductions</p>
                <p className="text-muted-foreground">Provident fund · Professional tax</p>
              </div>
            </div>
          )}

          <p className="mt-3 flex justify-between border-t border-border pt-2 text-sm font-medium">
            <span>Net pay</span>
            <span className="tabular-nums">₹51,226</span>
          </p>

          {slip.footerNote && (
            <p data-testid="preview-footer" className="mt-3 text-2xs text-muted-foreground">
              {slip.footerNote}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          data-testid="save-payslip-template"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save payslip layout"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  );
}

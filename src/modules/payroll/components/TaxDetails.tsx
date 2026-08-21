/**
 * The organisation's own tax identifiers.
 *
 * The same argument as an employee's UAN, one level up: none of this changes a
 * payslip by a rupee, and all of it decides whether a TDS return can be filed at
 * all. Every field is optional, because these arrive over weeks — and every one
 * that is filled in is shaped, because the portal rejects a malformed PAN hours
 * later without saying which one.
 *
 * TDS ITSELF IS NOT COMPUTED. It is entered per person per run, exactly as the
 * workbook does, and computing it needs a declaration and proof-of-investment
 * subsystem that is not part of this release. Recording who the deductor is, is
 * still worth doing; implying that a return will be generated is not.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { getPayrollSettings, savePayrollSettings } from "../handlers";
import { PayrollSettings } from "../contracts";

export default function TaxDetails() {
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
        setError(isAppError(e) ? e.message : "We couldn't load your tax details.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function edit(patch: Partial<PayrollSettings["taxDetails"]>) {
    setSaved(false);
    setConfig((c) => (c ? { ...c, taxDetails: { ...c.taxDetails, ...patch } } : c));
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

  const tax = config.taxDetails;

  return (
    <div className="space-y-4">
      <p
        data-testid="tds-not-computed"
        className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground"
      >
        Income tax is entered per person on a pay run, not computed here. Working it out needs
        declarations and proof of investment, which are not part of this release.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-muted-foreground">PAN</span>
          <input
            value={tax.pan}
            onChange={(e) => edit({ pan: e.target.value.toUpperCase() })}
            placeholder="AAAAA0000A"
            aria-label="Organisation PAN"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 uppercase"
          />
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">TAN</span>
          <input
            value={tax.tan}
            onChange={(e) => edit({ tan: e.target.value.toUpperCase() })}
            placeholder="AAAA00000A"
            aria-label="Organisation TAN"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 uppercase"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            The number you deduct tax under. Different from the PAN, and both are needed to file.
          </span>
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">TDS circle / AO code</span>
          <input
            value={tax.tdsCircle}
            onChange={(e) => edit({ tdsCircle: e.target.value })}
            placeholder="AAA / AA / 000 / 00"
            aria-label="TDS circle or AO code"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Tax paid</span>
          <select
            value={tax.paymentFrequency}
            onChange={(e) =>
              edit({
                paymentFrequency: e.target
                  .value as PayrollSettings["taxDetails"]["paymentFrequency"],
              })
            }
            aria-label="Tax payment frequency"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="monthly">Every month</option>
            <option value="quarterly">Every quarter</option>
          </select>
        </label>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Who signs the return</legend>

        <label className="text-sm">
          <span className="text-muted-foreground">Deductor is</span>
          <select
            value={tax.deductorType}
            onChange={(e) =>
              edit({
                deductorType: e.target.value as PayrollSettings["taxDetails"]["deductorType"],
              })
            }
            aria-label="Deductor type"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="employee">Somebody in this organisation</option>
            <option value="non_employee">Somebody outside it</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Name</span>
          <input
            value={tax.deductorName}
            onChange={(e) => edit({ deductorName: e.target.value })}
            aria-label="Deductor name"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Father&apos;s name</span>
          <input
            value={tax.deductorFatherName}
            onChange={(e) => edit({ deductorFatherName: e.target.value })}
            aria-label="Deductor father's name"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Asked for by the return, not by us.
          </span>
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          data-testid="save-tax-details"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save tax details"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  );
}

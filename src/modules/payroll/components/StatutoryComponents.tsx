/**
 * The statutory schemes: provident fund, state insurance, professional tax,
 * labour welfare fund, statutory bonus.
 *
 * Every one is a switch with an explainer, because none of them applies to
 * everybody. An establishment under twenty people need not register for
 * provident fund; professional tax and the labour welfare fund are levied by
 * STATES and the states disagree; statutory bonus depends on what somebody
 * earns.
 *
 * ── Where this diverges from the source spec, and why ──────────────────────
 *
 * The spec ships every scheme OFF behind an "Enable" button. Three of these
 * default ON, because provident fund, state insurance and professional tax have
 * been computed on every pay run this module has ever produced — defaulting
 * them off would mean this release quietly stripping all three from the next
 * payslip of every existing workspace. Switching one off is still one click.
 *
 * ── The preview ────────────────────────────────────────────────────────────
 *
 * The spec's own lesson, and the best thing on its screens: a live calculation
 * against a wage you choose beats a described rule. A rate is abstract; ₹2,400
 * against ₹20,000 is checkable, and an employer who knows their own numbers
 * spots a wrong one immediately.
 */

import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import { professionalTaxFor } from "@/payroll-core";
import { getPayrollSettings, savePayrollSettings } from "../handlers";
import { PayrollSettings, type StatutorySchemes } from "../contracts";

type SchemeKey = keyof StatutorySchemes;

const TABS: { key: SchemeKey; label: string; explainer: string; computes: boolean }[] = [
  {
    key: "epf",
    label: "Provident fund",
    explainer:
      "Any establishment with twenty or more employees must register for EPF. Contributions are a percentage of PF wages, which are the salary components you have marked as counting towards them.",
    computes: true,
  },
  {
    key: "esi",
    label: "State insurance",
    explainer:
      "ESI covers employees earning up to the wage ceiling. Somebody who crosses it mid-period keeps contributing until the contribution period ends — April to September, or October to March.",
    computes: true,
  },
  {
    key: "pt",
    label: "Professional tax",
    explainer:
      "A tax levied by the state, not by the centre, so the bands are the state's own. Karnataka charges ₹200 above ₹24,999 and nothing below it.",
    computes: true,
  },
  {
    key: "lwf",
    label: "Labour welfare fund",
    explainer:
      "A flat contribution from both sides, collected once a year in most states. Switching it on takes the figure out of your hands — the scheme decides it, including the nothing it takes in the other eleven months.",
    computes: true,
  },
  {
    key: "bonus",
    label: "Statutory bonus",
    explainer:
      "Between 8.33% and 20% of salary or the state minimum wage, whichever is higher. Recorded here; bonus runs are not part of this release, so nothing here reaches a payslip yet.",
    computes: false,
  },
];

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
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

export default function StatutoryComponents() {
  const [config, setConfig] = useState<PayrollSettings | null>(null);
  const [tab, setTab] = useState<SchemeKey>("epf");
  const [sampleWage, setSampleWage] = useState(20000);
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
        setError(isAppError(e) ? e.message : "We couldn't load your statutory settings.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = TABS.find((t) => t.key === tab)!;
  const schemes = config?.statutory;

  /**
   * The EPF preview, recomputed from the DRAFT so it answers the question being
   * asked rather than the one already saved. PF wages are capped at the ceiling
   * unless the organisation has chosen to charge on actual wages — which is the
   * same switch that makes a component's "below the ceiling only" treatment
   * mean anything.
   */
  const epfPreview = useMemo(() => {
    if (!schemes) return null;
    const e = schemes.epf;
    const wages = e.restrictToCeiling ? Math.min(sampleWage, e.wageCeiling) : sampleWage;
    const employee = Math.round(wages * (e.employeeRate / 100));
    const pension = Math.round(Math.min(wages, e.wageCeiling) * (e.pensionRate / 100));
    return {
      wages,
      employee,
      pension,
      employerEpf: employee - pension,
      edli: e.includeEdli ? Math.round(wages * (e.edliRate / 100)) : 0,
      admin: e.includeAdminCharges ? Math.round(wages * (e.adminChargeRate / 100)) : 0,
    };
  }, [schemes, sampleWage]);

  function edit<K extends SchemeKey>(key: K, patch: Partial<StatutorySchemes[K]>) {
    setSaved(false);
    setConfig((c) =>
      c ? { ...c, statutory: { ...c.statutory, [key]: { ...c.statutory[key], ...patch } } } : c,
    );
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

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (state === "error" || !config || !schemes) {
    return (
      <p role="alert" className="rounded-lg border border-border p-6 text-sm text-destructive">
        {error}
      </p>
    );
  }

  const enabled = schemes[tab].enabled;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Statutory scheme" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            data-testid={`scheme-tab-${t.key}`}
            onClick={() => {
              setTab(t.key);
              setError("");
            }}
            className={
              tab === t.key
                ? "rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground"
                : "rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
            }
          >
            <span className="flex items-center gap-2">
              {t.label}
              <span
                aria-hidden
                data-testid={`scheme-dot-${t.key}`}
                className={
                  schemes[t.key].enabled
                    ? "h-1.5 w-1.5 rounded-full bg-primary"
                    : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                }
              />
            </span>
          </button>
        ))}
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">{active.explainer}</p>

      {!active.computes && (
        <p
          data-testid="does-not-compute"
          className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground"
        >
          Recorded here, and not yet computed — bonus runs are not part of this release. Nothing on
          this tab reaches a payslip.
        </p>
      )}

      {/* Off is a real state, not an empty form. The spec's own pattern, and it
          means an administrator can tell "we don't run this" from "nobody has
          filled it in yet". */}
      {!enabled ? (
        <div
          data-testid={`scheme-off-${tab}`}
          className="rounded-lg border border-dashed border-border p-8 text-center"
        >
          <p className="text-sm text-muted-foreground">
            {active.label} is switched off for this workspace. Nothing is deducted or reported for
            it.
          </p>
          <button
            type="button"
            onClick={() => edit(tab, { enabled: true } as never)}
            data-testid={`enable-${tab}`}
            className="mt-4 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Enable {active.label.toLowerCase()}
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-border p-4">
          {/* ─────────────────────────────────────────────────────── EPF */}
          {tab === "epf" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted-foreground">Employee contribution</span>
                  <input
                    type="number"
                    step="0.01"
                    value={schemes.epf.employeeRate}
                    onChange={(e) => edit("epf", { employeeRate: Number(e.target.value) })}
                    aria-label="Employee contribution rate"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Pension share (EPS)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={schemes.epf.pensionRate}
                    onChange={(e) => edit("epf", { pensionRate: Number(e.target.value) })}
                    aria-label="Pension share rate"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Wage ceiling</span>
                  <input
                    type="number"
                    value={schemes.epf.wageCeiling}
                    onChange={(e) => edit("epf", { wageCeiling: Number(e.target.value) })}
                    aria-label="Wage ceiling"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Charged on</span>
                  <select
                    value={schemes.epf.restrictToCeiling ? "restricted" : "actual"}
                    onChange={(e) =>
                      edit("epf", { restrictToCeiling: e.target.value === "restricted" })
                    }
                    aria-label="Charged on"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="restricted">Wages restricted to the ceiling</option>
                    <option value="actual">Actual PF wages</option>
                  </select>
                  {!schemes.epf.restrictToCeiling && (
                    <span
                      data-testid="actual-wage-note"
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      Contributions are charged on the whole wage. This is also what makes a
                      component set to &ldquo;below the ceiling only&rdquo; behave differently from
                      one set to &ldquo;always&rdquo;.
                    </span>
                  )}
                </label>
              </div>

              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Employer-side charges</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={schemes.epf.includeEdli}
                    onChange={(e) => edit("epf", { includeEdli: e.target.checked })}
                    aria-label="Include EDLI"
                    className="mt-0.5 h-5 w-5"
                  />
                  <span className="text-muted-foreground">
                    Include the employer&apos;s EDLI contribution
                    <span className="block text-xs">
                      The employer&apos;s cost. Never deducted from anybody.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={schemes.epf.includeAdminCharges}
                    onChange={(e) => edit("epf", { includeAdminCharges: e.target.checked })}
                    aria-label="Include admin charges"
                    className="mt-0.5 h-5 w-5"
                  />
                  <span className="text-muted-foreground">Include administration charges</span>
                </label>
              </fieldset>

              {/* A rate is abstract; ₹2,400 against ₹20,000 is checkable. */}
              {epfPreview && (
                <div data-testid="epf-preview" className="rounded-md bg-secondary/40 p-4 text-sm">
                  <label className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">On a monthly wage of</span>
                    <input
                      type="number"
                      value={sampleWage}
                      onChange={(e) => setSampleWage(Number(e.target.value) || 0)}
                      aria-label="Sample monthly wage"
                      className="h-9 w-32 rounded-md border border-input bg-background px-2 text-right tabular-nums"
                    />
                  </label>
                  <dl className="mt-3 space-y-1">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">PF wages</dt>
                      <dd className="tabular-nums">{money(epfPreview.wages)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Employee — EPF</dt>
                      <dd className="tabular-nums">{money(epfPreview.employee)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Employer — pension (EPS)</dt>
                      <dd className="tabular-nums">{money(epfPreview.pension)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Employer — EPF</dt>
                      <dd className="tabular-nums">{money(epfPreview.employerEpf)}</dd>
                    </div>
                    {epfPreview.edli > 0 && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Employer — EDLI</dt>
                        <dd className="tabular-nums">{money(epfPreview.edli)}</dd>
                      </div>
                    )}
                    {epfPreview.admin > 0 && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Employer — admin charges</dt>
                        <dd className="tabular-nums">{money(epfPreview.admin)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </>
          )}

          {/* ─────────────────────────────────────────────────────── ESI */}
          {tab === "esi" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted-foreground">ESI number</span>
                <input
                  value={schemes.esi.number}
                  onChange={(e) => edit("esi", { number: e.target.value })}
                  placeholder="00-00-000000-000-0000"
                  aria-label="ESI number"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Wage ceiling</span>
                <input
                  type="number"
                  value={schemes.esi.grossCeiling}
                  onChange={(e) => edit("esi", { grossCeiling: Number(e.target.value) })}
                  aria-label="ESI wage ceiling"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Tested against what somebody is contracted to earn, not what they earned this
                  month — so unpaid leave cannot pull a well-paid employee into the scheme.
                </span>
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Employee contribution</span>
                <input
                  type="number"
                  step="0.01"
                  value={schemes.esi.employeeRate}
                  onChange={(e) => edit("esi", { employeeRate: Number(e.target.value) })}
                  aria-label="ESI employee rate"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Employer contribution</span>
                <input
                  type="number"
                  step="0.01"
                  value={schemes.esi.employerRate}
                  onChange={(e) => edit("esi", { employerRate: Number(e.target.value) })}
                  aria-label="ESI employer rate"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                />
              </label>
            </div>
          )}

          {/* ──────────────────────────────────────── professional tax */}
          {tab === "pt" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted-foreground">State</span>
                  <input
                    value={schemes.pt.state}
                    onChange={(e) => edit("pt", { state: e.target.value })}
                    aria-label="Professional tax state"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                  />
                  {/* The workbook this replaces files Andhra Pradesh's form for
                      a Karnataka establishment while applying Karnataka's slab.
                      Naming the state is how that stops going unnoticed. */}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    The bands below and the return you file must both be this state&apos;s.
                  </span>
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Registration number</span>
                  <input
                    value={schemes.pt.registrationNumber}
                    onChange={(e) => edit("pt", { registrationNumber: e.target.value })}
                    aria-label="Professional tax registration number"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                  />
                </label>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Bands, lowest first
                </p>
                <ul className="mt-2 space-y-2" data-testid="pt-slabs">
                  {schemes.pt.slabs.map((slab, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Up to</span>
                      <input
                        type="number"
                        value={slab.upTo ?? ""}
                        placeholder="and above"
                        aria-label={`Band ${i + 1} upper limit`}
                        onChange={(e) => {
                          const slabs = schemes.pt.slabs.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  upTo: e.target.value === "" ? null : Number(e.target.value),
                                }
                              : s,
                          );
                          edit("pt", { slabs });
                        }}
                        className="h-9 w-32 rounded-md border border-input bg-background px-2 text-right tabular-nums"
                      />
                      <span className="text-muted-foreground">charge</span>
                      <input
                        type="number"
                        value={slab.amount}
                        aria-label={`Band ${i + 1} amount`}
                        onChange={(e) => {
                          const slabs = schemes.pt.slabs.map((s, j) =>
                            j === i ? { ...s, amount: Number(e.target.value) } : s,
                          );
                          edit("pt", { slabs });
                        }}
                        className="h-9 w-28 rounded-md border border-input bg-background px-2 text-right tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          edit("pt", { slabs: schemes.pt.slabs.filter((_, j) => j !== i) })
                        }
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    edit("pt", { slabs: [...schemes.pt.slabs, { upTo: null, amount: 0 }] })
                  }
                  data-testid="add-slab"
                  className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  Add a band
                </button>

                <p
                  data-testid="pt-preview"
                  role="status"
                  className="mt-3 rounded-md bg-secondary/40 p-3 text-sm"
                >
                  On {money(sampleWage)} a month, professional tax would be{" "}
                  <span className="font-medium">
                    {money(professionalTaxFor(sampleWage, schemes.pt.slabs))}
                  </span>
                  .
                </p>
              </div>
            </>
          )}

          {/* ──────────────────────────────────── labour welfare fund */}
          {tab === "lwf" && (
            <>
              <p data-testid="lwf-takes-over" className="rounded-md bg-warning-muted p-3 text-sm">
                While this is on, the fund decides the figure — including the nothing it takes in
                the months it is not collected. Anything typed into a pay run for it is ignored.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted-foreground">State</span>
                  <input
                    value={schemes.lwf.state}
                    onChange={(e) => edit("lwf", { state: e.target.value })}
                    aria-label="Labour welfare fund state"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Collected</span>
                  <select
                    value={schemes.lwf.cycle}
                    onChange={(e) =>
                      edit("lwf", { cycle: e.target.value as StatutorySchemes["lwf"]["cycle"] })
                    }
                    aria-label="Collection cycle"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="yearly">Once a year</option>
                    <option value="monthly">Every month</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Employee contribution</span>
                  <input
                    type="number"
                    value={schemes.lwf.employee}
                    onChange={(e) => edit("lwf", { employee: Number(e.target.value) })}
                    aria-label="Labour welfare fund employee contribution"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Employer contribution</span>
                  <input
                    type="number"
                    value={schemes.lwf.employer}
                    onChange={(e) => edit("lwf", { employer: Number(e.target.value) })}
                    aria-label="Labour welfare fund employer contribution"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                  />
                </label>
                {schemes.lwf.cycle === "yearly" && (
                  <label className="text-sm">
                    <span className="text-muted-foreground">Collected in</span>
                    <select
                      value={schemes.lwf.deductInMonth}
                      onChange={(e) => edit("lwf", { deductInMonth: Number(e.target.value) })}
                      aria-label="Collected in"
                      className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </>
          )}

          {/* ──────────────────────────────────────── statutory bonus */}
          {tab === "bonus" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted-foreground">Paid</span>
                <select
                  value={schemes.bonus.frequency}
                  onChange={(e) =>
                    edit("bonus", {
                      frequency: e.target.value as StatutorySchemes["bonus"]["frequency"],
                    })
                  }
                  aria-label="Bonus frequency"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                >
                  <option value="yearly">Once a year</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Percentage</span>
                <input
                  type="number"
                  step="0.01"
                  value={schemes.bonus.percentage}
                  onChange={(e) => edit("bonus", { percentage: Number(e.target.value) })}
                  aria-label="Bonus percentage"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Between 8.33% and 20%. Anything outside that is not a policy decision, it is a
                  typo.
                </span>
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={() => edit(tab, { enabled: false } as never)}
            data-testid={`disable-${tab}`}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Switch {active.label.toLowerCase()} off for this workspace
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          data-testid="save-statutory"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save statutory settings"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  );
}

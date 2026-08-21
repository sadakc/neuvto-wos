/**
 * What this organisation pays, deducts, and lets people claim.
 *
 * Four categories in one shell — the source spec's own observation, and the
 * reason it says build the shell once and configure it per category. The list
 * columns and the form fields change; nothing else does.
 *
 * THE PERCENTAGES ARE A TEMPLATE, NOT A RULE. The workbook this replaces appears
 * to derive Basic as 50% of gross and HRA as 40% of Basic, and its formula bar
 * says so — but those rules hold for only 12 and 20 of its 44 employees.
 * Everyone else has hand-keyed amounts, and for all 44 the components sum
 * exactly to gross. So a percentage here fills in a number when somebody is
 * being set up; the amount that gets paid lives on the person, and an engine
 * that recomputed it would quietly restate three quarters of the workforce.
 *
 * FROZEN ONCE SOMEBODY IS ON IT. After a component reaches a real salary
 * structure, only its name and its default stay editable — flipping it out of
 * PF wages in November would silently restate every payslip computed against it
 * since April. The screen greys the locked fields and says why; the trigger in
 * the database is what actually refuses (`COMPONENT_IN_USE`), because the
 * screen is not what a stale browser tab goes through.
 */

import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import { listComponents, saveComponent, setComponentStatus } from "../handlers";
import { ComponentInput, type ComponentCategory, type SalaryComponent } from "../contracts";

const TABS: {
  key: ComponentCategory;
  label: string;
  blurb: string;
  /** Said plainly, because two of the four deliberately compute nothing yet. */
  reaches: string;
}[] = [
  {
    key: "earning",
    label: "Earnings",
    blurb: "The parts a salary is made of, and which of them make up provident fund wages.",
    reaches: "Paid on every payslip.",
  },
  {
    key: "deduction",
    label: "Deductions",
    blurb:
      "Standing amounts taken off — a canteen recovery, a loan instalment. A one-off correction is typed into the pay run itself, not set up here.",
    reaches: "Taken off every payslip, itemised separately from a one-off correction.",
  },
  {
    key: "benefit",
    label: "Benefits",
    blurb: "Schemes an employee opts into, such as voluntary provident fund.",
    reaches: "Configured only — nothing here reaches a payslip yet.",
  },
  {
    key: "reimbursement",
    label: "Reimbursements",
    blurb:
      "What people can claim back against payroll — fuel, telephone, leave travel. Not expenses, which are a different thing entirely.",
    reaches: "Configured only — nothing here reaches a payslip yet.",
  },
];

const EPF_LABEL: Record<SalaryComponent["epf"], string> = {
  always: "Always",
  under_threshold: "Below the ceiling only",
  off: "No",
};

/**
 * An empty draft for a new component.
 *
 * Built directly rather than through `ComponentInput.parse`, which was the
 * first version and threw: the schema requires a non-empty code, an empty form
 * has none, and the exception took the whole form down with it — clicking Add
 * did nothing at all, with no error anywhere. A blank form is not a valid
 * component and should not be asked to be one; validation happens on save.
 *
 * A deduction with no frequency and a reimbursement with no unclaimed policy
 * both fail that later validation, so those two start on the common answer
 * rather than as an empty field somebody discovers is required by pressing
 * Save.
 */
const blank = (category: ComponentCategory, order: number): ComponentInput => ({
  category,
  code: "",
  name: "",
  nameInPayslip: "",
  calculationType: "flat_amount",
  defaultAmount: null,
  defaultPercentage: null,
  epf: category === "earning" ? "always" : "off",
  esi: category === "earning",
  isTaxable: category === "earning",
  isProRata: true,
  isFbp: false,
  showOnPayslip: true,
  partOfStructure: category === "earning" || category === "deduction",
  frequency: category === "deduction" ? "recurring" : null,
  maxAmountPerMonth: null,
  unclaimedPolicy: category === "reimbursement" ? "carry_forward" : null,
  displayOrder: order,
});

export default function SalaryComponents() {
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [tab, setTab] = useState<ComponentCategory>("earning");
  const [draft, setDraft] = useState<ComponentInput | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setComponents(await listComponents());
    setState("ready");
  }

  useEffect(() => {
    load().catch((e) => {
      setError(isAppError(e) ? e.message : "We couldn't load your salary components.");
      setState("error");
    });
  }, []);

  const rows = useMemo(() => components.filter((c) => c.category === tab), [components, tab]);
  const active = TABS.find((t) => t.key === tab)!;

  function startNew() {
    setError("");
    setDraft(blank(tab, (components.length + 1) * 10));
  }

  function startEdit(c: SalaryComponent) {
    setError("");
    setDraft({
      id: c.id,
      category: c.category,
      code: c.code,
      name: c.name,
      nameInPayslip: c.nameInPayslip,
      calculationType: c.calculationType,
      defaultAmount: c.defaultAmount,
      defaultPercentage: c.defaultPercentage,
      epf: c.epf,
      esi: c.esi,
      isTaxable: c.isTaxable,
      isProRata: c.isProRata,
      isFbp: c.isFbp,
      showOnPayslip: c.showOnPayslip,
      partOfStructure: c.partOfStructure,
      frequency: c.frequency,
      maxAmountPerMonth: c.maxAmountPerMonth,
      unclaimedPolicy: c.unclaimedPolicy,
      displayOrder: c.displayOrder,
    });
  }

  const editing = draft?.id ? components.find((c) => c.id === draft.id) : undefined;
  const locked = editing?.inUse === true;

  function edit(patch: Partial<ComponentInput>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError("");

    const parsed = ComponentInput.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }

    setSaving(true);
    try {
      await saveComponent(parsed.data);
      setDraft(null);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(c: SalaryComponent) {
    setError("");
    try {
      await setComponentStatus(c.id, c.status === "active" ? "archived" : "active");
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't change. Please try again.");
    }
  }

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <p role="alert" className="rounded-lg border border-border p-6 text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* ───────────────────────────────────────────────────────── the tabs */}
      <div role="tablist" aria-label="Component category" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            data-testid={`tab-${t.key}`}
            onClick={() => {
              setTab(t.key);
              setDraft(null);
              setError("");
            }}
            className={
              tab === t.key
                ? "rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground"
                : "rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">{active.blurb}</p>

      {/* Said out loud rather than discovered. A component that looks configured
          and changes no payslip is worse than one that was never offered. */}
      <p
        data-testid={`reaches-${tab}`}
        className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground"
      >
        {active.reaches}
      </p>

      {/* ───────────────────────────────────────────────────────── the list */}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          {tab === "earning"
            ? "No earnings yet. Add Basic and DA first — most organisations then add HRA, conveyance and a balancing allowance."
            : `No ${active.label.toLowerCase()} yet.`}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((c) => (
            <li
              key={c.id}
              data-testid={`component-${c.code}`}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.code}</span>
                  {c.status === "archived" && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
                      inactive
                    </span>
                  )}
                  {c.inUse && (
                    <span
                      data-testid={`in-use-${c.code}`}
                      className="rounded border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground"
                    >
                      in use
                    </span>
                  )}
                </span>

                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {c.category === "earning" && (
                    <>
                      {c.calculationType === "flat_amount"
                        ? "Flat amount"
                        : c.calculationType === "percent_of_ctc"
                          ? `${c.defaultPercentage ?? 0}% of gross`
                          : `${c.defaultPercentage ?? 0}% of basic`}
                      {" · "}PF: {EPF_LABEL[c.epf]}
                      {" · "}ESI: {c.esi ? "Yes" : "No"}
                      {!c.isProRata && " · paid whole"}
                    </>
                  )}
                  {c.category === "deduction" &&
                    (c.frequency === "recurring" ? "Every month" : "One time")}
                  {c.category === "reimbursement" &&
                    `Up to ₹${(c.maxAmountPerMonth ?? 0).toLocaleString("en-IN")} a month · ${
                      c.unclaimedPolicy === "carry_forward" ? "carried forward" : "encashed monthly"
                    }`}
                  {c.category === "benefit" && "Opted into by the employee"}
                  {c.isFbp && " · flexible benefit"}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  Edit
                </button>
                {/* Soft status, reversible. Deleting is a separate, destructive
                    action and is never conflated with switching something off. */}
                <button
                  type="button"
                  onClick={() => toggleStatus(c)}
                  data-testid={`status-${c.code}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
                >
                  {c.status === "active" ? "Mark inactive" : "Mark active"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!draft && (
        <button
          type="button"
          onClick={startNew}
          data-testid="add-component"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Add {active.label.replace(/s$/, "").toLowerCase()}
        </button>
      )}

      {/* ───────────────────────────────────────────────────────── the form */}
      {draft && (
        <form onSubmit={save} className="space-y-4 rounded-lg border border-border p-4">
          {locked && (
            <p
              role="status"
              data-testid="frozen-notice"
              className="rounded-md bg-warning-muted p-3 text-sm"
            >
              Somebody&apos;s salary already uses this component, so only its name and its default
              can change. Everything else is fixed — changing it now would restate payslips that
              have already been issued. Add a new component instead.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Name</span>
              <input
                value={draft.name}
                onChange={(e) => edit({ name: e.target.value })}
                aria-label="Name"
                className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
              />
            </label>

            <label className="text-sm">
              <span className="text-muted-foreground">Name on the payslip</span>
              <input
                value={draft.nameInPayslip}
                onChange={(e) => edit({ nameInPayslip: e.target.value })}
                placeholder={draft.name || "Same as the name"}
                aria-label="Name on the payslip"
                className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
              />
            </label>

            <label className="text-sm">
              <span className="text-muted-foreground">Code</span>
              <input
                value={draft.code}
                disabled={locked}
                onChange={(e) => edit({ code: e.target.value })}
                placeholder="basic"
                aria-label="Code"
                className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Reaches a payslip and a CSV column header.
              </span>
            </label>

            {draft.category === "earning" && (
              <label className="text-sm">
                <span className="text-muted-foreground">How it is worked out</span>
                <select
                  value={draft.calculationType}
                  disabled={locked}
                  onChange={(e) =>
                    edit({ calculationType: e.target.value as ComponentInput["calculationType"] })
                  }
                  aria-label="How it is worked out"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
                >
                  <option value="flat_amount">A flat amount</option>
                  <option value="percent_of_ctc">A percentage of gross</option>
                  <option value="percent_of_basic">A percentage of basic</option>
                </select>
              </label>
            )}

            {/* Swaps rather than showing both, so the form stays short and
                there is never an amount and a percentage disagreeing. */}
            {draft.calculationType === "flat_amount" ? (
              <label className="text-sm">
                <span className="text-muted-foreground">
                  Default amount <span className="text-xs">(a starting point, per person)</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.defaultAmount ?? ""}
                  onChange={(e) =>
                    edit({ defaultAmount: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  aria-label="Default amount"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                />
              </label>
            ) : (
              <label className="text-sm">
                <span className="text-muted-foreground">Percentage</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.defaultPercentage ?? ""}
                  onChange={(e) =>
                    edit({
                      defaultPercentage: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  aria-label="Percentage"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                />
              </label>
            )}

            {draft.category === "deduction" && (
              <label className="text-sm">
                <span className="text-muted-foreground">How often</span>
                <select
                  value={draft.frequency ?? "recurring"}
                  onChange={(e) =>
                    edit({ frequency: e.target.value as ComponentInput["frequency"] })
                  }
                  aria-label="How often"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                >
                  <option value="recurring">Every month</option>
                  <option value="one_time">Once</option>
                </select>
              </label>
            )}

            {draft.category === "reimbursement" && (
              <>
                <label className="text-sm">
                  <span className="text-muted-foreground">Most claimable a month</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.maxAmountPerMonth ?? ""}
                    onChange={(e) =>
                      edit({
                        maxAmountPerMonth: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    aria-label="Most claimable a month"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-right tabular-nums"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">An unclaimed balance</span>
                  <select
                    value={draft.unclaimedPolicy ?? "carry_forward"}
                    onChange={(e) =>
                      edit({ unclaimedPolicy: e.target.value as ComponentInput["unclaimedPolicy"] })
                    }
                    aria-label="An unclaimed balance"
                    className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="carry_forward">Carries forward, encashed at year end</option>
                    <option value="encash_monthly">Is encashed each month</option>
                  </select>
                </label>
              </>
            )}
          </div>

          {draft.category === "earning" && (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Statutory treatment</legend>

              <label className="text-sm">
                <span className="text-muted-foreground">Counts towards PF wages</span>
                <select
                  value={draft.epf}
                  disabled={locked}
                  onChange={(e) => edit({ epf: e.target.value as ComponentInput["epf"] })}
                  aria-label="Counts towards PF wages"
                  className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
                >
                  <option value="always">Always</option>
                  <option value="under_threshold">Only below the wage ceiling</option>
                  <option value="off">Never</option>
                </select>
                {draft.epf === "under_threshold" && (
                  <span
                    data-testid="under-threshold-note"
                    className="mt-1 block text-xs text-muted-foreground"
                  >
                    This changes nothing while provident fund is charged on wages restricted to the
                    ceiling — capped, the two answers are identical. It applies once EPF is set to
                    charge on actual wages.
                  </span>
                )}
              </label>

              <label className="flex items-start gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  checked={draft.esi}
                  disabled={locked}
                  onChange={(e) => edit({ esi: e.target.checked })}
                  aria-label="Counts towards ESI"
                  className="mt-0.5 h-5 w-5"
                />
                <span className="text-muted-foreground">Counts towards ESI</span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isProRata}
                  disabled={locked}
                  onChange={(e) => edit({ isProRata: e.target.checked })}
                  aria-label="Reduced for days not worked"
                  className="mt-0.5 h-5 w-5"
                />
                <span className="text-muted-foreground">
                  Reduced for days not worked
                  <span className="block text-xs">
                    Off for a joining bonus — it should not become 19/31 of itself.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isTaxable}
                  disabled={locked}
                  onChange={(e) => edit({ isTaxable: e.target.checked })}
                  aria-label="Taxable"
                  className="mt-0.5 h-5 w-5"
                />
                <span className="text-muted-foreground">Taxable</span>
              </label>
            </fieldset>
          )}

          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Where it appears</legend>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.showOnPayslip}
                onChange={(e) => edit({ showOnPayslip: e.target.checked })}
                aria-label="Show on the payslip"
                className="mt-0.5 h-5 w-5"
              />
              <span className="text-muted-foreground">Show on the payslip</span>
            </label>

            {(draft.category === "earning" || draft.category === "reimbursement") && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isFbp}
                  onChange={(e) => edit({ isFbp: e.target.checked })}
                  aria-label="Part of the flexible benefit plan"
                  className="mt-0.5 h-5 w-5"
                />
                <span className="text-muted-foreground">Part of the flexible benefit plan</span>
              </label>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              data-testid="save-component"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save component"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

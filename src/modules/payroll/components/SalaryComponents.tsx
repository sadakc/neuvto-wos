/**
 * What this organisation pays, and how each part is worked out.
 *
 * THE PERCENTAGES ARE NOT HERE, AND THAT IS THE FINDING. The workbook this
 * replaces appears to derive Basic as 50% of gross and HRA as 40% of Basic —
 * its formula bar says so. Those rules hold for 12 and 20 of its 44 employees;
 * everyone else has hand-keyed amounts, and for all 44 the components sum
 * exactly to gross. So a percentage is a convenience for setting somebody up,
 * not a rule for paying them, and the amounts live on the person.
 *
 * What this screen defines is which components exist, their order on a payslip,
 * and the one flag the arithmetic reads: whether a component makes up PF wages.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { listComponents, saveComponent } from "../handlers";
import { ComponentInput, type SalaryComponent } from "../contracts";

const BLANK: ComponentInput = { code: "", name: "", countsForPfWages: true, displayOrder: 0 };

export default function SalaryComponents() {
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [draft, setDraft] = useState<ComponentInput>(BLANK);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const list = await listComponents();
    setComponents(list);
    setState("ready");
  }

  useEffect(() => {
    load().catch((e) => {
      setError(isAppError(e) ? e.message : "We couldn't load your salary components.");
      setState("error");
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = ComponentInput.safeParse({
      ...draft,
      displayOrder: (components.length + 1) * 10,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setSaving(true);
    try {
      await saveComponent(parsed.data);
      setDraft(BLANK);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive-muted p-3 text-sm"
        >
          {error}
        </p>
      )}

      {components.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No salary components yet. Add Basic and DA first — most organisations then add HRA,
          conveyance and a balancing allowance.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {components.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-3">
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {c.countsForPfWages ? "counts for PF wages" : "excluded from PF wages"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={save}
        className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      >
        <label className="text-sm">
          <span className="text-muted-foreground">Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="House rent allowance"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Code</span>
          <input
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            placeholder="hra"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 font-mono"
          />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.countsForPfWages}
            onChange={(e) => setDraft({ ...draft, countsForPfWages: e.target.checked })}
          />
          <span>Counts towards PF wages</span>
          <span className="text-xs text-muted-foreground">
            — leave unticked for house rent allowance
          </span>
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add component"}
          </button>
        </div>
      </form>
    </div>
  );
}

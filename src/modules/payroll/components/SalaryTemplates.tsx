/**
 * Named salary shapes, so setting somebody up is not typing eight amounts.
 *
 * A TEMPLATE IS A STARTING POINT AND STAYS ONE. Applying one copies its amounts
 * onto the person and then forgets it — there is no link back, and that is the
 * design rather than a shortcut:
 *
 *  - The workbook this replaces appears to derive Basic as 50% of gross and HRA
 *    as 40% of Basic. Those rules hold for 12 and 20 of its 44 employees, and
 *    everyone else has hand-keyed amounts. A template that stayed attached
 *    would make three quarters of that workforce unrepresentable.
 *  - A live link means editing a template restates the pay of everybody on it,
 *    retroactively, from a screen that looks like configuration. That is the
 *    freeze-after-association problem again, one table over — and this time
 *    with no trigger to catch it.
 *
 * Administrators only, for reading as well as writing. A template is not one
 * person's salary, but "the Manager template is ₹85,000" tells an employee what
 * their manager earns to within a rounding.
 */

import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import { listComponents, listTemplates, removeTemplate, saveTemplate } from "../handlers";
import { TemplateInput, type SalaryComponent, type SalaryTemplate } from "../contracts";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function SalaryTemplates() {
  const [templates, setTemplates] = useState<SalaryTemplate[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [openId, setOpenId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [t, c] = await Promise.all([listTemplates(), listComponents()]);
    setTemplates(t);
    setComponents(c);
    setState("ready");
  }

  useEffect(() => {
    load().catch((e) => {
      setError(isAppError(e) ? e.message : "We couldn't load your salary templates.");
      setState("error");
    });
  }, []);

  /** The same set a salary structure is made of, for the same reasons. */
  const structural = useMemo(
    () =>
      components.filter(
        (c) =>
          c.status === "active" &&
          c.partOfStructure &&
          (c.category === "earning" || c.category === "deduction"),
      ),
    [components],
  );
  const earnings = useMemo(() => structural.filter((c) => c.category === "earning"), [structural]);

  const draftGross = useMemo(
    () => earnings.reduce((total, c) => total + (Number(amounts[c.id]) || 0), 0),
    [amounts, earnings],
  );

  function open(t: SalaryTemplate | null) {
    setError("");
    setOpenId(t?.id ?? "new");
    setName(t?.name ?? "");
    setDescription(t?.description ?? "");
    const byComponent = new Map((t?.amounts ?? []).map((a) => [a.componentId, a.amount]));
    setAmounts(
      Object.fromEntries(structural.map((c) => [c.id, String(byComponent.get(c.id) ?? "")])),
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const parsed = TemplateInput.safeParse({
      id: openId === "new" ? undefined : openId,
      name,
      description,
      amounts: structural.map((c) => ({ componentId: c.id, amount: Number(amounts[c.id]) || 0 })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }

    setSaving(true);
    try {
      await saveTemplate(parsed.data);
      setOpenId(null);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError("");
    try {
      await removeTemplate(id);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't delete. Please try again.");
    }
  }

  if (state === "loading") return <div className="h-48 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <p role="alert" className="rounded-lg border border-border p-6 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (structural.length === 0) {
    return (
      <p
        data-testid="templates-need-components"
        className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"
      >
        Set up salary components first — a template is an amount against each of them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p
        data-testid="template-is-a-copy"
        className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground"
      >
        Applying a template copies its amounts onto the person. Editing it afterwards changes
        nobody&apos;s pay — which is deliberate: most people are paid something a little different
        from the shape they started on.
      </p>

      {templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No templates yet. Most organisations have a handful — one per grade, or per role.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {templates.map((t) => (
            <li key={t.id} data-testid={`template-${t.id}`} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {money(t.gross)} a month
                    {t.description ? ` · ${t.description}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (openId === t.id ? setOpenId(null) : open(t))}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    {openId === t.id ? "Close" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    data-testid={`delete-${t.id}`}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    Delete
                  </button>
                </span>
              </div>
              {openId === t.id && (
                <Form
                  structural={structural}
                  amounts={amounts}
                  setAmounts={setAmounts}
                  name={name}
                  setName={setName}
                  description={description}
                  setDescription={setDescription}
                  draftGross={draftGross}
                  saving={saving}
                  error={error}
                  onSubmit={save}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {openId === "new" ? (
        <div className="rounded-lg border border-border p-4">
          <Form
            structural={structural}
            amounts={amounts}
            setAmounts={setAmounts}
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            draftGross={draftGross}
            saving={saving}
            error={error}
            onSubmit={save}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => open(null)}
          data-testid="add-template"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Add a template
        </button>
      )}
    </div>
  );
}

function Form({
  structural,
  amounts,
  setAmounts,
  name,
  setName,
  description,
  setDescription,
  draftGross,
  saving,
  error,
  onSubmit,
}: {
  structural: SalaryComponent[];
  amounts: Record<string, string>;
  setAmounts: (a: Record<string, string>) => void;
  name: string;
  setName: (s: string) => void;
  description: string;
  setDescription: (s: string) => void;
  draftGross: number;
  saving: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Manager"
            aria-label="Template name"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">What it is for</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Front office, grade 3"
            aria-label="Template description"
            className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {structural.map((c) => (
          <label key={c.id} className="text-sm">
            <span className="text-muted-foreground">{c.name}</span>
            {c.category === "deduction" && (
              <span className="ml-1 text-xs text-muted-foreground">— deducted</span>
            )}
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={amounts[c.id] ?? ""}
              onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
              aria-label={`${c.name} in this template`}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-right tabular-nums"
            />
          </label>
        ))}
      </div>

      {/* The same sum the structure screen shows, for the same reason: a gross
          that is stored can disagree with the parts it is made of. */}
      <div className="flex items-center justify-between rounded-md bg-muted p-3 text-sm">
        <span className="text-muted-foreground">Monthly gross</span>
        <span data-testid="template-gross" className="font-medium tabular-nums">
          {money(draftGross)}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        data-testid="save-template"
        className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save template"}
      </button>
    </form>
  );
}

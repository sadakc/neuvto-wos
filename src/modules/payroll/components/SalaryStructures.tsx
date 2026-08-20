/**
 * What each person is paid, before anybody counts the days.
 *
 * This is the screen without which a pay run has nothing to compute, and until
 * now it did not exist — `saveStructure` was written, tested and reachable from
 * nowhere. Everyone in the workspace had no structure, and the pay run silently
 * omitted all of them (20260823130000).
 *
 * GROSS IS THE SUM, NOT A FIELD. In the workbook this replaces, the components
 * add up exactly to gross for all 44 employees, but the percentage rules its
 * formula bar advertises — basic is 50% of gross, HRA 40% of basic — hold for
 * only 12 and 20 of them. The rest are hand-keyed. So a percentage is a
 * convenience for setting somebody up, never a rule for paying them, and a
 * stored gross would be a second number free to disagree with the parts. Here
 * the total is added up as it is typed and cannot drift.
 *
 * EFFECTIVE FROM IS NOT DECORATION. A run uses the latest structure already in
 * force for that month, so dating a rise from the 1st pays it for the whole
 * month and dating it from the 15th does not touch that month at all. The
 * screen says which structure is current rather than which is newest, because
 * those differ the moment somebody enters a rise early — which is the ordinary
 * way to use this screen, not an edge case.
 */

import { useEffect, useMemo, useState } from "react";
import { isAppError } from "@/platform/errors";
import { listComponents, listStructures, saveStructure } from "../handlers";
import { StructureInput, type SalaryComponent, type StructureRow } from "../contracts";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** The 1st of the current month — the date a structure is almost always dated. */
function firstOfThisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function SalaryStructures() {
  const [rows, setRows] = useState<StructureRow[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfThisMonth());
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [people, comps] = await Promise.all([listStructures(), listComponents()]);
    setRows(people);
    setComponents(comps.filter((c) => c.status === "active"));
    setState("ready");
  }

  useEffect(() => {
    load().catch((e) => {
      setError(isAppError(e) ? e.message : "We couldn't load your salary structures.");
      setState("error");
    });
  }, []);

  const unpayable = useMemo(() => rows.filter((r) => r.effectiveFrom === null), [rows]);

  /** The live total of what is being typed — the same sum the engine will use. */
  const draftGross = useMemo(
    () => components.reduce((total, c) => total + (Number(amounts[c.id]) || 0), 0),
    [amounts, components],
  );

  function open(row: StructureRow) {
    setError("");
    setOpenId(row.employeeId);
    setEffectiveFrom(row.effectiveFrom ?? firstOfThisMonth());
    const byComponent = new Map(row.amounts.map((a) => [a.componentId, a.amount]));
    setAmounts(
      Object.fromEntries(components.map((c) => [c.id, String(byComponent.get(c.id) ?? "")])),
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!openId) return;
    setError("");

    const parsed = StructureInput.safeParse({
      employeeId: openId,
      effectiveFrom,
      // An untouched box is zero, not absent — a component somebody does not
      // receive is a legitimate zero, and the database accepts it.
      amounts: components.map((c) => ({ componentId: c.id, amount: Number(amounts[c.id]) || 0 })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }

    setSaving(true);
    try {
      await saveStructure(parsed.data);
      setOpenId(null);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive-muted p-3 text-sm"
      >
        {error}
      </p>
    );
  }

  // Nothing here works without components, and saying so beats an empty grid
  // with a save button that cannot succeed.
  if (components.length === 0) {
    return (
      <p
        data-testid="no-components-yet"
        className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
      >
        Set up salary components first — a structure is an amount against each of them. Basic and DA
        is the usual place to start.
      </p>
    );
  }

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

      {/*
       * The warning this whole screen exists for. Anybody without a structure is
       * named — not counted — because a count is what the workbook effectively
       * showed when it lost its 45th employee: nothing.
       */}
      {unpayable.length > 0 && (
        <div
          role="status"
          data-testid="no-structure-warning"
          className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm"
        >
          <p className="font-medium">
            These people have no salary structure and cannot be paid until they do:
          </p>
          <ul className="mt-2 space-y-1">
            {unpayable.map((r) => (
              <li key={r.employeeId}>{r.employeeName ?? "Unnamed"}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.employeeId} className="p-3" data-testid={`structure-${row.employeeId}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{row.employeeName ?? "Unnamed"}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.employeeCode ?? "no employee code"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {row.effectiveFrom ? (
                  <span className="text-sm tabular-nums">
                    {money(row.fixedGross)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      since {row.effectiveFrom}
                    </span>
                  </span>
                ) : (
                  <span className="rounded-md bg-warning-muted px-2 py-1 text-xs">
                    no structure
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => (openId === row.employeeId ? setOpenId(null) : open(row))}
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  {openId === row.employeeId
                    ? "Close"
                    : row.effectiveFrom
                      ? "Edit"
                      : "Set up salary"}
                </button>
              </div>
            </div>

            {openId === row.employeeId && (
              <form onSubmit={save} className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {components.map((c) => (
                    <label key={c.id} className="text-sm">
                      <span className="text-muted-foreground">{c.name}</span>
                      {!c.countsForPfWages && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          — excluded from PF wages
                        </span>
                      )}
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={amounts[c.id] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                        aria-label={`${c.name} for ${row.employeeName ?? "this person"}`}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-right tabular-nums"
                      />
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap items-end justify-between gap-3 rounded-md bg-muted p-3">
                  <label className="text-sm">
                    <span className="text-muted-foreground">Effective from</span>
                    <input
                      type="date"
                      value={effectiveFrom}
                      onChange={(e) => setEffectiveFrom(e.target.value)}
                      aria-label={`Effective from for ${row.employeeName ?? "this person"}`}
                      className="mt-1 h-9 rounded-md border border-input bg-background px-2"
                    />
                  </label>
                  <p className="text-sm" data-testid="draft-gross">
                    <span className="text-muted-foreground">Monthly gross </span>
                    <span className="font-medium tabular-nums">{money(draftGross)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      — the components added up
                    </span>
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save salary structure"}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

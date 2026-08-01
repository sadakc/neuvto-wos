/**
 * The leave a customer's staff had already taken before Neuvto existed.
 *
 * The runbook is blunt about why this matters: an employee who has taken six
 * days this year but shows a full balance will be allowed to book leave they
 * have not got. Everything else in the product assumes it started counting on
 * day one; this is where somebody says otherwise.
 *
 * Contributed as an adminSection rather than routed, so it appears in Settings
 * without the platform naming Leave (D30) — the same arrangement as leave types.
 *
 * It lists people whose balance row does not exist yet, showing the entitlement
 * they *would* get. Those are exactly the people an opening balance is for, and
 * a screen that only listed materialised rows would hide them.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isAppError, toAppError } from "@/platform/errors";

interface Row {
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  entitledDays: number;
  carryforwardDays: number;
  usedDays: number;
  availableDays: number;
}

const MESSAGES: Record<string, string> = {
  OPENING_BALANCE_OVERDRAWN:
    "That is more than they were ever entitled to. Check the number, or raise their entitlement first.",
  NEGATIVE_DAYS: "Days cannot be negative.",
  MODULE_NOT_ENABLED: "Leave is switched off for this workspace.",
  FORBIDDEN: "Only an administrator can set an opening balance.",
  LEAVE_TYPE_NOT_FOUND: "That leave type no longer exists.",
};

export default function OpeningBalances() {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");
  const [filter, setFilter] = useState("");

  async function load() {
    const { data, error: e } = await supabase.rpc("leave_all_balances");
    if (e) throw toAppError(e, "leave_all_balances");
    setRows(
      (data ?? []).map((r) => ({
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        leaveTypeId: r.leave_type_id,
        leaveTypeName: r.leave_type_name,
        entitledDays: Number(r.entitled_days),
        carryforwardDays: Number(r.carryforward_days),
        usedDays: Number(r.used_days),
        availableDays: Number(r.available_days),
      })),
    );
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(row: Row, used: number, carryforward: number) {
    const key = `${row.employeeId}:${row.leaveTypeId}`;
    setError("");
    setNotice("");
    setSaving(key);
    try {
      const { error: e } = await supabase.rpc("leave_set_opening_balance", {
        _employee_id: row.employeeId,
        _leave_type_id: row.leaveTypeId,
        _used: used,
        _carryforward: carryforward,
      });
      if (e) {
        const code = Object.keys(MESSAGES).find((k) => (e.message ?? "").includes(k));
        throw code ? new Error(MESSAGES[code]) : toAppError(e, "leave_set_opening_balance");
      }
      setNotice(`${row.employeeName} · ${row.leaveTypeName} updated.`);
      await load();
    } catch (err) {
      setError(
        err instanceof Error && !isAppError(err)
          ? err.message
          : isAppError(err)
            ? err.message
            : "That could not be saved.",
      );
      // Reload regardless: the inputs are showing numbers the database refused,
      // and leaving them there reads as though they stuck.
      await load().catch(() => {});
    } finally {
      setSaving("");
    }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.employeeName.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load balances just now. Try refreshing.
      </p>
    );
  }

  return (
    <div>
      <input
        aria-label="Find somebody"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find somebody"
        className="h-12 w-full rounded-md border border-border bg-background px-3 text-sm sm:max-w-xs"
      />

      {error && (
        <p role="alert" data-testid="balances-error" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          data-testid="balances-notice"
          className="mt-3 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {visible.map((r) => (
          <li key={`${r.employeeId}:${r.leaveTypeId}`} data-testid="balance-row" className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.employeeName}</span>
                <span className="block text-xs text-muted-foreground">{r.leaveTypeName}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {r.availableDays} of {r.entitledDays + r.carryforwardDays} available
              </span>
            </div>

            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save(r, Number(f.get("used")), Number(f.get("carry")));
              }}
            >
              <label className="flex-1 text-xs text-muted-foreground">
                Already taken this year
                <input
                  name="used"
                  type="number"
                  min={0}
                  step="0.5"
                  defaultValue={r.usedDays}
                  data-testid="used-days"
                  className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </label>
              <label className="flex-1 text-xs text-muted-foreground">
                Carried over from last year
                <input
                  name="carry"
                  type="number"
                  min={0}
                  step="0.5"
                  defaultValue={r.carryforwardDays}
                  data-testid="carry-days"
                  className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={saving === `${r.employeeId}:${r.leaveTypeId}`}
                data-testid="save-balance"
                className="inline-flex min-h-12 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {saving === `${r.employeeId}:${r.leaveTypeId}` ? "Saving…" : "Save"}
              </button>
            </form>
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          {rows.length === 0
            ? "Nobody has joined this workspace yet, or no leave types are configured."
            : "Nobody by that name."}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Every change is recorded with the previous value, so a balance that moves can be traced.
      </p>
    </div>
  );
}

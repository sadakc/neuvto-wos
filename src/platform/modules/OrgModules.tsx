/**
 * The customer's own module switches.
 *
 * D44 has two levels, and this is the second one. Neuvto grants a module — the
 * row exists — and the customer decides whether it is switched on. They cannot
 * grant themselves anything: `insert` and `delete` on `organization_modules`
 * left the application entirely, and the `update` grant is column-scoped to
 * `enabled` so an edit cannot quietly become an escalation.
 *
 * Platform, not a module, and it deliberately names none: it renders whatever
 * `modules` holds. Attendance and Payroll appear here the day they are granted,
 * with nothing in this file changing.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isAdmin, type CurrentUser } from "@/platform/auth";
import { AppError, isAppError } from "@/platform/errors";

interface GrantedModule {
  key: string;
  name: string;
  status: string;
  enabled: boolean;
}

/**
 * What this organisation has been granted. RLS scopes it — "read own enabled
 * modules" — so a customer sees their own row and nothing about anyone else's
 * arrangements.
 */
async function listGranted(): Promise<GrantedModule[]> {
  const { data, error } = await supabase
    .from("organization_modules")
    .select("module_key, enabled, modules(name, status)");

  if (error) throw new AppError("INTERNAL_ERROR", "We couldn't load your modules.", 500);

  return (data ?? []).map((r) => ({
    key: r.module_key,
    name: (r.modules as { name: string } | null)?.name ?? r.module_key,
    status: (r.modules as { status: string } | null)?.status ?? "available",
    enabled: r.enabled,
  }));
}

export function OrgModules({ user }: { user: CurrentUser | null }) {
  const [modules, setModules] = useState<GrantedModule[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listGranted()
      .then((m) => {
        if (cancelled) return;
        setModules(m);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: string, enabled: boolean) {
    setError("");
    // Optimistic, then reconciled from the server. Switching a module is the
    // kind of thing somebody does once and watches, so it should feel instant —
    // but the server's answer is what ends up on screen.
    setModules((ms) => ms.map((m) => (m.key === key ? { ...m, enabled } : m)));

    const { error: e } = await supabase
      .from("organization_modules")
      .update({ enabled, enabled_at: enabled ? new Date().toISOString() : null })
      .eq("module_key", key);

    if (e) {
      setError(
        isAppError(e)
          ? e.message
          : "That couldn't be changed. Your administrator may have to do it.",
      );
    }
    try {
      setModules(await listGranted());
    } catch {
      /* the message above already says what happened */
    }
  }

  if (state === "loading") return <div className="h-24 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your modules just now. Try refreshing.
      </p>
    );
  }

  if (modules.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No modules have been added to this workspace yet. Get in touch with Neuvto to add one.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {modules.map((m) => (
          <li
            key={m.key}
            data-testid="org-module-row"
            className="flex items-center justify-between gap-4 p-4"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{m.name}</span>
              <span className="block text-xs text-muted-foreground">
                {m.enabled
                  ? "On — everyone in this workspace can use it"
                  : "Off — hidden for everyone"}
              </span>
            </span>
            <button
              onClick={() => void toggle(m.key, !m.enabled)}
              disabled={!isAdmin(user)}
              data-testid="toggle-org-module"
              className="inline-flex h-12 shrink-0 items-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-40"
            >
              {m.enabled ? "Switch off" : "Switch on"}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" data-testid="module-error" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Switching a module off hides it for everyone and stops it accepting anything new. Nothing is
        deleted — switching it back on restores what was there.
      </p>
    </div>
  );
}

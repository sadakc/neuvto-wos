/**
 * Platform · Auth · Changing somebody's access (D78)
 *
 * One panel per person, opened from People (and later from the Employee
 * Card's Manage dialog). It edits the whole set of roles, because that is
 * what `member_set_roles` takes, and it offers each caller only what they may
 * change:
 *
 *   · A Super Admin sees every role.
 *   · An Admin sees the approver roles. Any administrator-tier role the person
 *     already holds is shown, read-only, as granted by a Super Admin, and is
 *     sent back unchanged, so an Admin editing approvers cannot strip an
 *     administrator by omission.
 *   · Nobody sees a panel for themselves.
 *   · D84: below the roles, the company's switched-on modules. A Super Admin
 *     ticks who administers which; anybody else sees the grants read-only.
 *     A company-wide Admin already administers every module, so for them the
 *     section says so instead of offering boxes that would change nothing.
 *
 * None of that is the enforcement. The database refuses the set whole if any
 * change is not the caller's to make; what this screen hides, it hides so
 * nobody is offered a switch that will only be refused.
 */

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { isAppError } from "@/platform/errors";
import {
  APP_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SUPER_ADMIN_GRANTS,
  type AppRole,
} from "./contracts";

const GROUPS: Array<{ heading: string; roles: AppRole[]; reserved: boolean }> = [
  { heading: "Approves", roles: ["manager", "supervisor", "coordinator"], reserved: false },
  { heading: "Administers", roles: ["super_admin", "org_admin", "hr_admin"], reserved: true },
  {
    heading: "Sees restricted data",
    roles: ["payroll_officer", "statutory_officer"],
    reserved: true,
  },
];

/** A switched-on module, as the access panel offers it. */
export interface AdministrableModule {
  key: string;
  name: string;
}

const ADMINISTERS_EVERYTHING: readonly AppRole[] = ["super_admin", "org_admin", "hr_admin"];

export function AccessEditor({
  personName,
  roles,
  callerIsSuperAdmin,
  modules = [],
  moduleAdmin = [],
  onSave,
  onCancel,
}: {
  personName: string;
  roles: readonly AppRole[];
  callerIsSuperAdmin: boolean;
  /** D84. The company's switched-on modules. */
  modules?: readonly AdministrableModule[];
  /** D84. The modules this person administers by grant. */
  moduleAdmin?: readonly string[];
  onSave: (roles: AppRole[], modules: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState<Set<AppRole>>(new Set(roles));
  const [chosenModules, setChosenModules] = useState<Set<string>>(new Set(moduleAdmin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const editable = (r: AppRole) => callerIsSuperAdmin || !SUPER_ADMIN_GRANTS.includes(r);
  const modulesChanged =
    chosenModules.size !== moduleAdmin.length || moduleAdmin.some((m) => !chosenModules.has(m));
  const changed =
    chosen.size !== roles.length || roles.some((r) => !chosen.has(r)) || modulesChanged;
  // Read from what is ticked now, so ticking Org Admin says at once that the
  // module boxes stop mattering.
  const everyModule = ADMINISTERS_EVERYTHING.some((r) => chosen.has(r));
  const shownModules = modules.filter((m) => callerIsSuperAdmin || moduleAdmin.includes(m.key));

  const toggle = (r: AppRole) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  async function save() {
    setBusy(true);
    setError("");
    try {
      // Employee is implied; the database adds it when nothing else is held.
      const next = APP_ROLES.filter((r) => r !== "employee" && chosen.has(r));
      await onSave(
        next.length ? next : ["employee"],
        modules.map((m) => m.key).filter((k) => chosenModules.has(k)),
      );
    } catch (e) {
      setError(isAppError(e) ? e.message : "That access change couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="access-editor"
      className="mt-3 rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <p className="text-card-title font-semibold tracking-card-title">Access for {personName}</p>
      <p className="mt-1 text-caption text-muted-foreground">
        Everybody can see their own record and apply for leave. These are added on top.
        {!callerIsSuperAdmin && " Administrator roles are changed by a Super Admin."}
      </p>

      {GROUPS.map((g) => {
        const shown = g.roles.filter((r) => editable(r) || roles.includes(r));
        if (shown.length === 0) return null;
        return (
          <fieldset key={g.heading} className="mt-4">
            <legend className="text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
              {g.heading}
            </legend>
            <div className="mt-2 grid gap-2">
              {shown.map((r) => {
                const canEdit = editable(r);
                const inputId = `${id}-${r}`;
                return (
                  <label
                    key={r}
                    htmlFor={inputId}
                    className={cn(
                      "flex min-h-12 items-start gap-2.5 rounded-md border border-border px-3 py-2.5",
                      canEdit ? "cursor-pointer hover:bg-muted" : "bg-muted",
                    )}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      data-testid={`role-${r}`}
                      checked={chosen.has(r)}
                      disabled={!canEdit}
                      onChange={() => toggle(r)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{ROLE_LABELS[r]}</span>
                      <span className="block text-caption text-muted-foreground">
                        {canEdit
                          ? ROLE_DESCRIPTIONS[r]
                          : "Granted by a Super Admin. Only a Super Admin can remove it."}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {shownModules.length > 0 && (
        <fieldset className="mt-4" data-testid="module-admin">
          <legend className="text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
            Administers a module
          </legend>
          {everyModule ? (
            <p className="mt-2 text-caption text-muted-foreground" data-testid="module-admin-all">
              An administrator role above already runs every module.
            </p>
          ) : (
            <div className="mt-2 grid gap-2">
              {shownModules.map((m) => {
                const inputId = `${id}-module-${m.key}`;
                return (
                  <label
                    key={m.key}
                    htmlFor={inputId}
                    className={cn(
                      "flex min-h-12 items-start gap-2.5 rounded-md border border-border px-3 py-2.5",
                      callerIsSuperAdmin ? "cursor-pointer hover:bg-muted" : "bg-muted",
                    )}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      data-testid={`module-admin-${m.key}`}
                      checked={chosenModules.has(m.key)}
                      disabled={!callerIsSuperAdmin}
                      onChange={() =>
                        setChosenModules((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.key)) next.delete(m.key);
                          else next.add(m.key);
                          return next;
                        })
                      }
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{m.name} Admin</span>
                      <span className="block text-caption text-muted-foreground">
                        {callerIsSuperAdmin
                          ? moduleAdminDescription(m)
                          : "Granted by a Super Admin. Only a Super Admin can remove it."}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      {error && (
        <p role="alert" data-testid="access-error" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-12 items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !changed}
          data-testid="access-save"
          className="inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Saving…" : "Save access"}
        </button>
      </div>
      {!changed && (
        <p className="mt-2 text-right text-caption text-muted-foreground">
          Nothing has changed yet.
        </p>
      )}
    </div>
  );
}

function moduleAdminDescription(m: AdministrableModule): string {
  if (m.key === "employee") {
    return "Adds people and manages every employee card, including statutory numbers and bank details. Nothing in other modules.";
  }
  return `Runs ${m.name}: its configuration, reports and everybody's records in it. Nothing in other modules.`;
}

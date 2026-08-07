import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getCurrentUser,
  isAdmin,
  APP_ROLES,
  ROLE_LABELS,
  type AppRole,
  type CurrentUser,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import {
  APPROVER_RULES,
  listApprovalLevels,
  removeApprovalLevel,
  saveApprovalLevel,
  type ApprovalLevel,
  type ApproverRule,
} from "@/platform/approvals";

export const Route = createFileRoute("/app/approval-rules")({
  ssr: false,
  head: () => ({ meta: [{ title: "Approval rules — Neuvto WOS" }] }),
  component: ApprovalRulesPage,
});

const RULE_LABELS: Record<ApproverRule, string> = {
  reporting_manager: "Their manager",
  manager_of_manager: "Their manager's manager",
  role: "Anyone with a role",
};

/**
 * Who approves leave, and when a second signature is needed.
 *
 * D5 made chains data rather than code, and test scenario 6 has always been the
 * proof: change the threshold from 3 to 5, and a 4-day request needs one level
 * instead of two, with no deploy. This is the screen that scenario needs — until
 * now the rows existed and nothing could edit them.
 *
 * Everything a level can be is constrained in the database. This form mirrors
 * those constraints rather than restating them loosely, because a half-specified
 * level is the worst outcome: a condition with no operator never matches, and
 * reads as "this level doesn't apply" instead of as the mistake it is.
 */
function ApprovalRulesPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLevels(await listApprovalLevels("leave_request"));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (cancelled) return;
        setUser(u);
        if (!isAdmin(u)) {
          setState("denied");
          return;
        }
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

  function edit(id: string, patch: Partial<ApprovalLevel>) {
    setLevels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setSaved(false);
  }

  async function onSave(level: ApprovalLevel) {
    if (!user) return;
    setError("");
    setSavingId(level.id);
    try {
      await saveApprovalLevel(user.organizationId, "leave_request", level);
      await load();
      setSaved(true);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function onAddLevel() {
    if (!user) return;
    setError("");
    const next = (levels[levels.length - 1]?.level ?? 0) + 1;
    try {
      await saveApprovalLevel(user.organizationId, "leave_request", {
        level: next,
        approverRule: "manager_of_manager",
        approverRole: null,
        conditionField: "working_days",
        conditionOp: ">",
        conditionValue: 3,
        escalateAfterDays: 2,
      });
      await load();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That level couldn't be added.");
    }
  }

  async function onRemove(id: string) {
    setError("");
    try {
      await removeApprovalLevel(id);
      await load();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That level couldn't be removed.");
    }
  }

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your administrator decides who approves leave.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load your approval rules. Try refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="font-display text-xl font-semibold tracking-tight">Approval rules</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Who signs off leave. Level 1 always applies; later levels apply only when their condition
        matches. Requests already in flight keep the rules they were submitted under.
      </p>

      {levels.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No approval levels. Nobody can submit leave that needs approval until there is at least
          one — requests would be refused rather than approved.
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {levels.map((l) => (
          <li
            key={l.id}
            data-testid="approval-level"
            className="rounded-lg border border-border p-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-base font-semibold">Level {l.level}</h2>
              {l.level > 1 && (
                <button
                  onClick={() => onRemove(l.id)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`rule-${l.id}`} className="block text-sm font-medium">
                  Who approves
                </label>
                <select
                  id={`rule-${l.id}`}
                  value={l.approverRule}
                  onChange={(e) => {
                    const rule = e.target.value as ApproverRule;
                    // Clearing the role alongside the rule keeps
                    // chain_role_present satisfiable without a second step.
                    edit(l.id, {
                      approverRule: rule,
                      approverRole: rule === "role" ? (l.approverRole ?? "hr_admin") : null,
                    });
                  }}
                  className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {APPROVER_RULES.map((r) => (
                    <option key={r} value={r}>
                      {RULE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>

              {l.approverRule === "role" && (
                <div>
                  <label htmlFor={`role-${l.id}`} className="block text-sm font-medium">
                    Which role
                  </label>
                  <select
                    id={`role-${l.id}`}
                    value={l.approverRole ?? "hr_admin"}
                    onChange={(e) => edit(l.id, { approverRole: e.target.value as AppRole })}
                    className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {/* Employee is excluded, and until D57 this filter was the
                        ONLY thing excluding it — `chain_role_present` required
                        an approver_role alongside a 'role' rule and had no
                        opinion on which. `chain_role_can_approve` now refuses it
                        in the database, so this list is presentation again
                        rather than the rule. */}
                    {APP_ROLES.filter((r) => r !== "employee").map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Level 1 always applies, so a condition on it would be a level that
                sometimes leaves a request with no approver at all. */}
            {l.level > 1 && (
              <div className="mt-4">
                <span className="block text-sm font-medium">Only when</span>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">the request is longer than</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={l.conditionValue ?? ""}
                    onChange={(e) =>
                      edit(l.id, {
                        conditionField: "working_days",
                        conditionOp: ">",
                        conditionValue: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    data-testid="threshold"
                    className="h-12 w-20 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">working days</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank to make this level always apply
                </p>
              </div>
            )}

            <div className="mt-4">
              <label htmlFor={`esc-${l.id}`} className="block text-sm font-medium">
                Chase after
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id={`esc-${l.id}`}
                  type="number"
                  min={0}
                  max={30}
                  value={l.escalateAfterDays ?? ""}
                  onChange={(e) =>
                    edit(l.id, {
                      escalateAfterDays: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="h-12 w-20 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
                />
                <span className="text-sm text-muted-foreground">days without a decision</span>
              </div>
            </div>

            <button
              onClick={() => onSave(l)}
              disabled={savingId === l.id}
              data-testid="save-level"
              className="mt-4 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {savingId === l.id ? "Saving…" : "Save this level"}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" data-testid="chain-error" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && <p className="mt-4 text-sm text-muted-foreground">Saved</p>}

      <button
        onClick={onAddLevel}
        data-testid="add-level"
        className="mt-6 inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
      >
        Add another level
      </button>
    </div>
  );
}

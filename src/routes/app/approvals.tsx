import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { getCurrentUser, isAdmin, type CurrentUser } from "@/platform/auth";
import { Delegations } from "@/platform/approvals/Delegations";
import { isAppError } from "@/platform/errors";
import {
  approveMany,
  listApprovalQueue,
  type ApprovalQueueItem,
  type BulkOutcome,
} from "@/platform/approvals";
import { getApprovalViews, moduleByKey, type ModuleApprovalView } from "@/platform/modules";

export const Route = createFileRoute("/app/approvals")({
  ssr: false,
  head: () => ({ meta: [{ title: "Approvals — Neuvto WOS" }] }),
  component: ApprovalsPage,
});

/**
 * Everything waiting on you, whatever raised it.
 *
 * **This file names no module.** It is handed an `entity_type` as an opaque
 * string and asks whichever module claimed it to render the row — the same
 * arrangement as the dashboard's cards and the settings page's sections. A
 * manager running Leave and, later, Attendance visits one queue rather than
 * hunting through two.
 *
 * Until this existed, nobody could decide anything. `approval_decide()` has been
 * in the database since step 4 with no caller anywhere in the application, so a
 * request routed correctly, emailed the right approver, and then waited forever.
 */
function ApprovalsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<ApprovalQueueItem[]>([]);
  const [views, setViews] = useState<Map<string, ModuleApprovalView & { moduleKey: string }>>(
    new Map(),
  );
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  /** Leave phase 2: the requests ticked for "Approve selected". */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    outcomes: BulkOutcome[];
    names: Map<string, string>;
  } | null>(null);

  async function load(u: CurrentUser | null) {
    const [queue, registered] = await Promise.all([listApprovalQueue(), getApprovalViews(u)]);
    setItems(queue);
    setViews(registered);
    // A request decided elsewhere is no longer selectable.
    setSelected(
      (prev) => new Set([...prev].filter((id) => queue.some((q) => q.approvalRequestId === id))),
    );
  }

  async function onApproveSelected() {
    const ids = items.map((i) => i.approvalRequestId).filter((id) => selected.has(id));
    const names = new Map(items.map((i) => [i.approvalRequestId, i.requesterName]));
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const outcomes = await approveMany(ids);
      setBulkResult({ outcomes, names });
      setSelected(new Set());
      await load(user);
    } catch (e) {
      setError(isAppError(e) ? e.message : "Those couldn't be approved.");
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (cancelled) return;
        setUser(u);
        await load(u);
        if (!cancelled) setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load your approvals.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-36 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-page-title font-semibold tracking-page-title">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="text-page-title font-semibold tracking-page-title">Approvals</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Waiting on you. Something appears here only while it is at your level — an earlier level
        that has not decided yet is not yours to act on.
      </p>

      {bulkResult && (
        <div
          role="status"
          data-testid="bulk-result"
          className="mt-6 rounded-lg border border-border bg-card p-4 text-sm shadow-card"
        >
          <p className="font-medium">
            {bulkResult.outcomes.filter((o) => o.approved).length} approved.
          </p>
          {bulkResult.outcomes
            .filter((o) => !o.approved)
            .map((o) => (
              <p key={o.approvalRequestId} className="mt-1 text-muted-foreground">
                {bulkResult.names.get(o.approvalRequestId) ?? "One request"}: {o.message}
              </p>
            ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mt-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-card">
          <span className="text-sm text-muted-foreground">
            Approving does not ask for a reason. To reject, decide each one on its own.
          </span>
          <button
            type="button"
            onClick={() => void onApproveSelected()}
            disabled={bulkBusy}
            data-testid="approve-selected"
            className="inline-flex h-12 shrink-0 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {bulkBusy ? "Approving…" : `Approve selected (${selected.size})`}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing is waiting on you.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {items.map((item) => {
            const view = views.get(item.entityType);
            const Renderer = view?.component;

            return (
              <li
                key={item.approvalRequestId}
                data-testid="approval-item"
                className="rounded-lg border border-border p-4"
              >
                {/* The platform's own header: who, how long, which level. True of
                    anything the engine carries, so it needs no module to render. */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selected.has(item.approvalRequestId)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.approvalRequestId)) next.delete(item.approvalRequestId);
                          else next.add(item.approvalRequestId);
                          return next;
                        })
                      }
                      aria-label={`Select ${item.requesterName}'s request`}
                      className="size-4 accent-primary"
                    />
                    {item.requesterName}
                  </label>
                  <span
                    data-testid="waiting"
                    className={
                      overTarget(item)
                        ? "text-xs font-medium text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {waitingLine(item)}
                  </span>
                </div>
                {item.onBehalfOf && (
                  <p data-testid="on-behalf-of" className="mt-1 text-xs text-muted-foreground">
                    {item.onBehalfOf}&apos;s approval, handed to you while they are away.
                  </p>
                )}
                {item.escalatedFrom && (
                  <p data-testid="escalated-from" className="mt-1 text-xs text-muted-foreground">
                    Moved to you from {item.escalatedFrom}, who had it longer than the target.
                  </p>
                )}

                <div className="mt-3">
                  {Renderer ? (
                    <Suspense fallback={<div className="h-24 animate-pulse rounded bg-muted" />}>
                      <Renderer item={item} onDecided={() => void load(user)} />
                    </Suspense>
                  ) : (
                    /*
                      No module registered a view for this entity type — it was
                      switched off, or removed from the build, while a decision
                      was still in flight.

                      It is still shown. A pending approval that vanishes from the
                      one screen listing it is somebody's request never being
                      decided, and nobody would ever find out why. Saying so
                      plainly is worse-looking and far better.
                    */
                    <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                      This was raised by something this workspace no longer has switched on, so it
                      can&apos;t be shown in full. It is still waiting on you — ask your
                      administrator to switch the module back on to decide it.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* D92. The modules this workspace has approvals for, named. */}
      <Delegations
        isAdmin={isAdmin(user)}
        modules={[...new Set([...views.values()].map((v) => v.moduleKey))]
          .map((key) => ({ key, name: moduleByKey(key)?.name ?? key }))
          .sort((a, b) => a.name.localeCompare(b.name))}
      />
    </div>
  );
}

function overTarget(item: ApprovalQueueItem): boolean {
  return item.targetDays !== null && item.daysAtLevel > item.targetDays;
}

/**
 * How long it has waited where it is now, against that level's target. Past
 * the target it moves to somebody above the approver (D87); the sweep runs
 * every fifteen minutes, so "moving up" is what is about to happen.
 */
function waitingLine(item: ApprovalQueueItem): string {
  const where = item.requiredLevels > 1 ? ` at level ${item.level} of ${item.requiredLevels}` : "";
  if (item.daysAtLevel === 0) {
    return item.requiredLevels > 1
      ? `reached level ${item.level} of ${item.requiredLevels} today`
      : "raised today";
  }
  const waited = `waiting ${item.daysAtLevel} day${item.daysAtLevel === 1 ? "" : "s"}${where}`;
  if (item.targetDays === null) return waited;
  return overTarget(item)
    ? `${waited} · over the ${item.targetDays}-day target, moving up`
    : `${waited} · moves up after ${item.targetDays} day${item.targetDays === 1 ? "" : "s"}`;
}

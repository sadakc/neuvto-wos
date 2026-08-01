import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { getCurrentUser, type CurrentUser } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { listApprovalQueue, type ApprovalQueueItem } from "@/platform/approvals";
import { getApprovalViews, type ModuleApprovalView } from "@/platform/modules";

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

  async function load(u: CurrentUser | null) {
    const [queue, registered] = await Promise.all([listApprovalQueue(), getApprovalViews(u)]);
    setItems(queue);
    setViews(registered);
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
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
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
      <h1 className="font-display text-xl font-semibold tracking-tight">Approvals</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Waiting on you. Something appears here only while it is at your level — an earlier level
        that has not decided yet is not yours to act on.
      </p>

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
                  <span className="text-sm font-medium">{item.requesterName}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.daysWaiting === 0
                      ? "raised today"
                      : `waiting ${item.daysWaiting} day${item.daysWaiting === 1 ? "" : "s"}`}
                    {item.requiredLevels > 1 && ` · level ${item.level} of ${item.requiredLevels}`}
                  </span>
                </div>

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
    </div>
  );
}

/**
 * Org chart (bundle §7.5). Built from the reporting line, four levels at a
 * time, starting from the person you report to so you see yourself and your
 * peers first. Deeper levels are one press away ("Start here") rather than
 * drawn all at once, and the chart scrolls inside its own box, never the page.
 *
 * Anybody with reports has a − beside them that folds their team away and a
 * + that opens it again (D106), and the whole chart folds or opens at once.
 */

import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getUserId } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import type { OrgChartNode } from "../contracts";
import { getOrgChart } from "../handlers";
import { PersonLink } from "./PersonLink";

const ORG_CHART_DEPTH = 4;

/** Where the chart starts for this viewer: their manager, else the top. */
function startingPoint(nodes: OrgChartNode[], me: string | null): string | null {
  const mine = nodes.find((n) => n.profileId === me);
  if (mine?.managerProfileId && nodes.some((n) => n.profileId === mine.managerProfileId)) {
    return mine.managerProfileId;
  }
  return null; // the top: everybody whose manager is nobody, or not in the chart
}

export default function OrgChart() {
  const [nodes, setNodes] = useState<OrgChartNode[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  // Whose teams are folded away. Everybody's is open to begin with.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getOrgChart(), getUserId().catch(() => null)])
      .then(([n, uid]) => {
        if (cancelled) return;
        setNodes(n);
        setMe(uid);
        setRoot(startingPoint(n, uid));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(isAppError(e) ? e.message : "The org chart didn't load.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byManager = useMemo(() => {
    const m = new Map<string | null, OrgChartNode[]>();
    const known = new Set((nodes ?? []).map((n) => n.profileId));
    for (const n of nodes ?? []) {
      // A manager who is not in the chart (deactivated, or never signed in)
      // would orphan their reports; they are drawn at the top instead.
      const key = n.managerProfileId && known.has(n.managerProfileId) ? n.managerProfileId : null;
      m.set(key, [...(m.get(key) ?? []), n]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    }
    return m;
  }, [nodes]);

  const rootNode = nodes?.find((n) => n.profileId === root) ?? null;
  const managers = (nodes ?? []).filter((n) => (byManager.get(n.profileId)?.length ?? 0) > 0);

  /** The − or + beside somebody with reports, or the space one would take. */
  function foldButton(n: OrgChartNode, reports: number) {
    if (reports === 0) return <span aria-hidden className="inline-block size-9 shrink-0" />;
    const open = !folded.has(n.profileId);
    const who = n.fullName ?? "this person";
    return (
      <button
        type="button"
        onClick={() => toggle(n.profileId)}
        aria-expanded={open}
        aria-label={open ? `Hide ${who}'s team` : `Show ${who}'s team`}
        title={open ? "Hide their team" : "Show their team"}
        data-testid="org-fold"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {open ? <Minus className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
      </button>
    );
  }
  const parentOfRoot = rootNode?.managerProfileId ?? null;

  function branch(parent: string | null, level: number): React.ReactNode {
    const children = byManager.get(parent) ?? [];
    if (children.length === 0) return null;
    return (
      <ul className={level > 0 ? "ml-4 border-l border-border pl-4" : ""}>
        {children.map((n) => {
          const reports = byManager.get(n.profileId)?.length ?? 0;
          const hasMore = reports > 0 && !folded.has(n.profileId);
          return (
            <li key={n.profileId} className="py-1.5" data-testid="org-node">
              <div className="flex items-center gap-2">
                {foldButton(n, reports)}
                <div
                  className={
                    "inline-flex min-w-[14rem] flex-col rounded-lg border px-3 py-2 " +
                    (n.profileId === me ? "border-primary bg-accent" : "border-border bg-card")
                  }
                >
                  <PersonLink employeeId={n.id} className="text-sm font-medium">
                    {n.fullName ?? "Unnamed"}
                  </PersonLink>
                  <span className="text-caption text-muted-foreground">
                    {n.designation ?? "No designation"} · {n.directReports}{" "}
                    {n.directReports === 1 ? "report" : "reports"}
                  </span>
                </div>
              </div>
              {hasMore &&
                (level + 1 < ORG_CHART_DEPTH ? (
                  branch(n.profileId, level + 1)
                ) : (
                  <button
                    type="button"
                    onClick={() => setRoot(n.profileId)}
                    data-testid="org-start-here"
                    className="ml-4 mt-1 block text-sm font-medium text-primary hover:underline"
                  >
                    Start here to see their team
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Org Chart</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Who reports to whom, {ORG_CHART_DEPTH} levels at a time. People who are deactivated, or
          invited but not yet signed in, are not drawn.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {nodes === null && !error ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : nodes && nodes.length > 0 ? (
        <section className="min-w-0 rounded-xl border border-border bg-card shadow-card">
          {root !== null && root !== undefined && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">Starting from</span>
              <span className="font-medium">{rootNode?.fullName}</span>
              <button
                type="button"
                onClick={() =>
                  setRoot(
                    parentOfRoot && nodes.some((n) => n.profileId === parentOfRoot)
                      ? parentOfRoot
                      : null,
                  )
                }
                data-testid="org-up"
                className="ml-auto text-sm font-medium text-primary hover:underline"
              >
                Up one level
              </button>
            </div>
          )}
          {managers.length > 0 && (
            <div className="flex flex-wrap justify-end gap-3 border-b border-border px-4 py-2 text-sm">
              <button
                type="button"
                onClick={() => setFolded(new Set(managers.map((n) => n.profileId)))}
                data-testid="org-fold-all"
                className="inline-flex min-h-9 items-center font-medium text-primary hover:underline"
              >
                Fold every team
              </button>
              <button
                type="button"
                onClick={() => setFolded(new Set())}
                data-testid="org-open-all"
                className="inline-flex min-h-9 items-center font-medium text-primary hover:underline"
              >
                Open every team
              </button>
            </div>
          )}
          <div className="overflow-x-auto px-4 py-3" data-testid="org-chart">
            {root ? (
              <ul>
                <li className="py-1.5" data-testid="org-node">
                  <div className="flex items-center gap-2">
                    {foldButton(rootNode!, byManager.get(root)?.length ?? 0)}
                    <div className="inline-flex min-w-[14rem] flex-col rounded-lg border border-border bg-card px-3 py-2">
                      <PersonLink employeeId={rootNode!.id} className="text-sm font-medium">
                        {rootNode!.fullName ?? "Unnamed"}
                      </PersonLink>
                      <span className="text-caption text-muted-foreground">
                        {rootNode!.designation ?? "No designation"} · {rootNode!.directReports}{" "}
                        {rootNode!.directReports === 1 ? "report" : "reports"}
                      </span>
                    </div>
                  </div>
                  {!folded.has(root) && branch(root, 1)}
                </li>
              </ul>
            ) : (
              branch(null, 0)
            )}
          </div>
        </section>
      ) : (
        !error && <p className="text-sm text-muted-foreground">Nobody has signed in yet.</p>
      )}
    </div>
  );
}

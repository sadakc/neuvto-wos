import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { getCurrentUser, isAdmin, type CurrentUser } from "@/platform/auth";
import { getModuleReports, type ModuleReport } from "@/platform/modules";

export const Route = createFileRoute("/app/reports")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reports — Neuvto WOS" }] }),
  component: ReportsPage,
});

/**
 * Reports, owned by the platform and filled by modules.
 *
 * This file names no module, imports none, and knows nothing about leave — the
 * same arrangement as Settings and the dashboard. When a second module reports
 * on something, it appears here by declaring `reports` in its manifest and
 * changing nothing in this file (D30).
 *
 * One report is shown at a time rather than all stacked. Each is a table of
 * every person or every request in the organisation, and three of those on one
 * page is a scroll nobody reads — the tab also gives the export button an
 * unambiguous subject.
 */
function ReportsPage() {
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [reports, setReports] = useState<(ModuleReport & { moduleKey: string })[]>([]);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u: CurrentUser | null = await getCurrentUser();
        if (cancelled) return;

        // Presentation only. Every report function behind these raises FORBIDDEN
        // for a non-admin itself — a screen that is merely not linked is not a
        // permission, and this check exists so the page says so rather than
        // rendering empty tables.
        if (!isAdmin(u)) {
          setState("denied");
          return;
        }

        const list = await getModuleReports(u);
        if (cancelled) return;
        setReports(list);
        setActiveId(list[0]?.id ?? "");
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        console.error("reports load failed", e);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reports cover everybody in the workspace, so they are limited to administrators.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load your reports. Try refreshing.
        </p>
      </div>
    );
  }

  // No modules enabled, or none that report. Not an error — the module-removal
  // check runs the application with Leave deleted, and this page has to work.
  if (reports.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing reports yet. Reports appear here as the modules in this workspace are switched on.
        </p>
      </div>
    );
  }

  const active = reports.find((r) => r.id === activeId) ?? reports[0];
  const Active = active.component;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-xl font-semibold tracking-tight">Reports</h1>

      <div
        role="tablist"
        aria-label="Reports"
        className="mt-4 flex flex-wrap gap-2 border-b border-border"
      >
        {reports.map((r) => (
          <button
            key={`${r.moduleKey}:${r.id}`}
            role="tab"
            aria-selected={r.id === active.id}
            data-testid={`report-tab-${r.id}`}
            onClick={() => setActiveId(r.id)}
            className={`min-h-12 rounded-t-md px-4 py-2 text-sm ${
              r.id === active.id
                ? "border-b-2 border-foreground font-medium text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {r.title}
          </button>
        ))}
      </div>

      {active.description && (
        <p className="mt-4 max-w-prose text-sm text-muted-foreground">{active.description}</p>
      )}

      <div className="mt-6">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
          <Active />
        </Suspense>
      </div>
    </div>
  );
}

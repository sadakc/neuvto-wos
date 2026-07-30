/**
 * Every page a module owns.
 *
 * TanStack discovers routes from files on disk, so a module folder cannot
 * contribute one by itself. This single catch-all resolves the path against the
 * enabled modules and renders whatever claims it — which is what lets a module
 * own its pages without owning files in `src/routes/`, and lets deleting a
 * module folder simply stop serving them.
 *
 * The cost, stated plainly: module pages lose TanStack's typed links and become
 * strings. That was the trade taken for keeping a module in one folder. If typed
 * links matter more later, thin per-module route files under
 * `src/routes/app/<key>/` are the alternative.
 *
 * A path no enabled module claims is a genuine 404 — including a module the
 * organisation has switched off, whose pages must stop existing rather than
 * merely stop being linked.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { resolveModuleRoute } from "@/platform/modules";

export const Route = createFileRoute("/app/$")({
  component: ModulePage,
});

function ModulePage() {
  const { _splat } = Route.useParams();
  const [state, setState] = useState<"loading" | "found" | "missing">("loading");
  const [Component, setComponent] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    resolveModuleRoute(_splat ?? "")
      .then((hit) => {
        if (cancelled) return;
        if (!hit) {
          setState("missing");
          return;
        }
        setComponent(() => hit.route.component as ComponentType);
        setState("found");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [_splat]);

  if (state === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-24 max-w-md animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (state === "missing" || !Component) {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page either doesn&apos;t exist or belongs to something your organisation hasn&apos;t
          switched on.
        </p>
      </div>
    );
  }

  return <Component />;
}

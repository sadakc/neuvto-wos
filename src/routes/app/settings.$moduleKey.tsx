/**
 * One module's configuration, and nothing else's.
 *
 * The blocks rendered here have always belonged to their modules — Leave's
 * leave types live in `src/modules/leave/`, payroll's salary components in
 * `src/modules/payroll/`, contributed through `adminSections` on the manifest.
 * What changed is that they now get a page of their own instead of being
 * appended to the bottom of the organisation's.
 *
 * This file names no module. It is handed a key from the URL and asks the
 * registry what that module contributes; Attendance and Learning will render
 * here the day they ship, with nothing in this file changing (D30, D32).
 *
 * A module the organisation has not switched on has no configuration page at
 * all, rather than an empty one — its settings stop existing along with its
 * pages, exactly as the catch-all route already treats its routes. That is
 * presentation; every function behind these sections enforces `module_enabled_for()`
 * itself (D44), because a page that is merely not reachable is not a switch.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import type { CurrentUser } from "@/platform/auth";
import { getModuleAdminSections, type ModuleAdminSection } from "@/platform/modules";
import { AdminGate } from "@/components/shared/admin-gate";

export const Route = createFileRoute("/app/settings/$moduleKey")({
  component: ModuleSettingsRoute,
});

function ModuleSettingsRoute() {
  const { moduleKey } = Route.useParams();
  // Keyed on the module so switching between two modules' settings remounts
  // rather than showing the previous module's sections under the new name.
  return (
    <AdminGate key={moduleKey}>
      {(user) => <ModuleSettings user={user} moduleKey={moduleKey} />}
    </AdminGate>
  );
}

function ModuleSettings({ user, moduleKey }: { user: CurrentUser; moduleKey: string }) {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [name, setName] = useState("");
  const [sections, setSections] = useState<ModuleAdminSection[]>([]);

  useEffect(() => {
    let cancelled = false;

    getModuleAdminSections(user, moduleKey)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setState("missing");
          return;
        }
        setName(found.moduleName);
        setSections(found.sections);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [user, moduleKey]);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (state === "missing") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Nothing to configure here</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This module either doesn&apos;t exist or your organisation hasn&apos;t switched it on. You
          can switch modules on under Organisation settings.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="font-display text-xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Configuration this module owns. Your departments, working week and holidays are shared with
        every module and are set under Organisation.
      </p>

      {sections.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {name} has nothing to configure yet.
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="mt-12" data-testid={`section-${section.id}`}>
            <h2 className="font-display text-lg font-semibold tracking-tight">{section.title}</h2>
            {section.description && (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {section.description}
              </p>
            )}
            <div className="mt-4">
              <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
                <section.component />
              </Suspense>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

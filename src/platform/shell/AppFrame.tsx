/**
 * Platform · Shell · AppFrame
 *
 * The Core HR shell (D76): a module rail, a top bar, the active module's tab
 * bar, and the screen. Layout responds to the shell's own width through the
 * `app` container and to the content area's width through `screen`, never to
 * the browser window, so the same screen is correct beside the rail, without
 * it, and in a narrow pane (DESIGN_SYSTEM §6).
 *
 * The frame knows no module. It is handed the shell model built from
 * manifests, and the person's identity for the top bar.
 */

import { useLocation, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { railMode } from "./fit";
import { locate, type ShellModule } from "./model";
import { ModuleRail } from "./ModuleRail";
import { TabBar } from "./TabBar";
import { useSize } from "./useSize";

/** Below this usable height the shell compacts (phone landscape is ~390px). */
export const SHORT_HEIGHT = 600;

export function AppFrame({
  modules,
  brand,
  actions,
  children,
}: {
  modules: readonly ShellModule[];
  brand: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const { width } = useSize(stage);
  const { pathname } = useLocation();
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const m = typeof search.m === "string" ? search.m : undefined;

  const { module, tab } = locate(modules, { pathname, module: m });
  // Before the first measurement the width is 0; assume the desktop rail
  // rather than flashing the phone grid on every load.
  const mode = width === 0 ? "column" : railMode(width);
  const short = typeof window !== "undefined" && window.innerHeight < SHORT_HEIGHT;

  const rail = <ModuleRail modules={modules} activeKey={module.key} mode={mode} brand={brand} />;

  return (
    <div
      ref={setStage}
      data-short={short}
      data-rail={mode}
      className="group/stage @container/app min-h-dvh w-full bg-background"
    >
      <div className={cn("flex min-h-dvh", mode === "column" ? "items-start" : "flex-col")}>
        {rail}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "z-30 flex items-center gap-3.5 border-b border-border bg-card px-5 py-2.5 @max-[640px]/app:flex-wrap @max-[640px]/app:px-4",
              mode === "column" && "sticky top-0",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-bar-title font-semibold tracking-bar-title">
                {module.name}
              </p>
              {tab && (
                <p className="truncate font-mono text-caption text-muted-foreground group-data-[short=true]/stage:hidden">
                  {tab.label}
                </p>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
          </header>
          <div className={cn(mode === "column" ? "sticky top-[57px] z-20" : "sticky top-0 z-20")}>
            <TabBar module={module} activeTabId={tab?.id ?? null} />
          </div>
          {/* A block, not a flex column. In a flex column a child with auto
              margins (every existing page is `mx-auto max-w-…`) shrink-wraps
              to its content instead of taking the screen's width, and a wide
              table then widened the page by 375px at phone width. */}
          <main className="app-screen @container/screen w-full max-w-[1520px] min-w-0 px-5 pt-5 pb-18 @max-[640px]/app:px-4 @max-[640px]/app:pt-4 group-data-[short=true]/stage:pt-3">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

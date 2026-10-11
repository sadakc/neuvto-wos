/**
 * Platform · Shell · ModuleRail
 *
 * Algorithm 2 (DESIGN_SYSTEM §7). A vertical rail above 1000px, a horizontal
 * row with overflow into a `Modules` chip from 540 to 1000, a 2-up grid with
 * short labels below 540. The mode comes from the stage's measured width and
 * what is shown comes from `fitRail`; this component only measures and draws.
 *
 * Row mode measures every chip in an invisible copy of the row, so the visible
 * row is fitted against real widths in the current font and never has to be
 * drawn wrong first to find out it does not fit.
 */

import { Link } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fitRail, type RailMode } from "./fit";
import { groupBySection, SECTION_HEADINGS_FROM, tabSearch, type ShellModule } from "./model";
import { NavPanel } from "./NavPanel";
import { useSize } from "./useSize";

function entry(m: ShellModule) {
  const first = m.tabs.find((t) => t.group === "main" && !t.soon) ?? m.tabs.find((t) => !t.soon);
  return { to: first?.to ?? "/app", search: first ? tabSearch(first) : undefined };
}

function badgeOf(m: ShellModule) {
  return m.tabs.reduce((sum, t) => sum + (t.badge ?? 0), 0);
}

export function ModuleRail({
  modules,
  activeKey,
  mode,
  brand,
}: {
  modules: readonly ShellModule[];
  activeKey: string;
  mode: RailMode;
  brand: ReactNode;
}) {
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const { width: rowWidth } = useSize(rowEl);
  const [chipWidths, setChipWidths] = useState<number[]>([]);
  const [overflowWidth, setOverflowWidth] = useState(0);
  const [open, setOpen] = useState(false);

  const activeIndex = modules.findIndex((m) => m.key === activeKey);
  const badges = modules.map(badgeOf);

  useLayoutEffect(() => {
    if (mode !== "row" || !measureRef.current) return;
    const chips = Array.from(measureRef.current.querySelectorAll<HTMLElement>("[data-chip]"));
    setChipWidths(chips.map((c) => c.offsetWidth));
    setOverflowWidth(
      measureRef.current.querySelector<HTMLElement>("[data-overflow]")?.offsetWidth ?? 0,
    );
  }, [mode, modules, rowWidth]);

  const fit = useMemo(
    () =>
      fitRail({
        mode,
        rowWidth: Math.max(0, rowWidth - 24),
        chipWidths: chipWidths.length === modules.length ? chipWidths : modules.map(() => 0),
        overflowWidth,
        activeIndex,
        badges,
      }),
    [mode, rowWidth, chipWidths, overflowWidth, activeIndex, badges, modules],
  );

  const chipClass = (current: boolean, extra?: string) =>
    cn(
      "flex min-h-12 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-nav font-medium",
      current
        ? "border-accent-line bg-accent font-semibold text-accent-foreground"
        : "border-transparent text-foreground-secondary hover:bg-muted hover:text-foreground",
      extra,
    );

  const chipBody = (m: ShellModule, short: boolean) => {
    const Icon = m.icon;
    const current = m.key === activeKey;
    const badge = badgeOf(m);
    return (
      <>
        {Icon && <Icon className="size-[18px] shrink-0" aria-hidden />}
        <span className="min-w-0 truncate">{short ? m.short : m.name}</span>
        {badge > 0 && (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 font-mono text-table-header tabular-nums",
              current
                ? "bg-primary text-primary-foreground"
                : "bg-surface3 text-foreground-secondary",
            )}
          >
            {badge}
          </span>
        )}
      </>
    );
  };

  const item = (m: ShellModule, short: boolean, extra?: string) => {
    const current = m.key === activeKey;
    const { to, search } = entry(m);
    return (
      <Link
        key={m.key}
        to={to}
        search={search as never}
        aria-current={current ? "page" : undefined}
        data-testid={`rail-${m.key}`}
        className={chipClass(current, extra)}
      >
        {chipBody(m, short)}
      </Link>
    );
  };

  const hidden = modules.filter((_, i) => !fit.visible[i]);
  const overflow = (label: string, full: boolean) =>
    fit.hiddenCount > 0 && (
      <div className={cn("relative", full && "col-span-2")}>
        <button
          ref={overflowRef}
          type="button"
          aria-expanded={open}
          aria-controls="rail-overflow"
          onClick={() => setOpen((v) => !v)}
          data-testid="rail-overflow"
          className="flex min-h-12 w-full items-center gap-2.5 rounded-md border border-border bg-muted px-2.5 py-2 text-nav font-medium whitespace-nowrap text-foreground-secondary hover:border-border-strong"
        >
          <LayoutGrid className="size-[18px] shrink-0" aria-hidden />
          {label}
          {fit.hiddenBadge > 0 && (
            <span className="ml-auto rounded-full bg-destructive px-1.5 font-mono text-table-header text-destructive-foreground tabular-nums">
              {fit.hiddenBadge}
            </span>
          )}
        </button>
        <NavPanel
          id="rail-overflow"
          open={open}
          onClose={() => setOpen(false)}
          trigger={overflowRef}
          full={full}
          groups={groupBySection(full ? modules : hidden).map(({ section, modules: ms }) => ({
            heading: section,
            items: ms.map((m) => ({
              key: m.key,
              label: m.name,
              ...entry(m),
              badge: badgeOf(m) || undefined,
              current: m.key === activeKey,
            })),
          }))}
        />
      </div>
    );

  if (mode === "column") {
    const headed = modules.length >= SECTION_HEADINGS_FROM;
    return (
      <aside className="sticky top-0 flex h-dvh w-[246px] shrink-0 flex-col overflow-auto border-r border-border bg-card">
        <div className="border-b border-border px-4 pt-4 pb-3.5">{brand}</div>
        <p className="px-4 pt-4 pb-1.5 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase group-data-[short=true]/stage:hidden">
          Modules
        </p>
        <nav aria-label="Modules" className="flex flex-col gap-0.5 px-2 pb-4">
          {headed
            ? groupBySection(modules).map(({ section, modules: ms }) => (
                <div key={section} className="flex flex-col gap-0.5">
                  <p className="px-2.5 pt-3 pb-1 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
                    {section}
                  </p>
                  {ms.map((m) => item(m, false))}
                </div>
              ))
            : modules.map((m) => item(m, false))}
        </nav>
      </aside>
    );
  }

  if (mode === "grid") {
    return (
      <div className="border-b border-border bg-card">
        <div className="px-4 pt-3 pb-2">{brand}</div>
        <nav aria-label="Modules" className="grid grid-cols-2 gap-1.5 px-3 pb-3">
          {modules.map((m, i) => (fit.visible[i] ? item(m, true, "min-w-0") : null))}
          {overflow(`All ${modules.length} modules`, true)}
        </nav>
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-card">
      <div className="px-4 pt-3 pb-1.5 group-data-[short=true]/stage:hidden">{brand}</div>
      <div ref={setRowEl} className="relative px-3 pb-3 group-data-[short=true]/stage:pt-2">
        {/* The measuring copy. Invisible, out of flow, and hidden from
            assistive technology: it exists only to be measured. */}
        {/* Clipped: an invisible element still widens the page's scroll area, and
          this copy is wider than a phone by design. Inside a zero-overflow box
          it keeps its natural width for measuring and adds none to the page. */}
        <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
          <div
            ref={measureRef}
            className="absolute top-0 left-0 flex w-max gap-1.5 whitespace-nowrap"
          >
            {modules.map((m) => (
              <span
                key={m.key}
                data-chip
                className={chipClass(m.key === activeKey, "shrink-0 whitespace-nowrap")}
              >
                {chipBody(m, false)}
              </span>
            ))}
            <span
              data-overflow
              className="inline-flex min-h-12 items-center gap-2.5 rounded-md border px-2.5 text-nav font-medium"
            >
              <LayoutGrid className="size-[18px]" />
              Modules
              <span className="px-1.5 font-mono text-table-header">99</span>
            </span>
          </div>
        </div>
        <nav aria-label="Modules" className="flex items-center gap-1.5 overflow-hidden">
          {modules.map((m, i) =>
            fit.visible[i] ? item(m, false, "shrink-0 whitespace-nowrap") : null,
          )}
          {overflow("Modules", false)}
        </nav>
      </div>
    </div>
  );
}

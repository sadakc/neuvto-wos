/**
 * Platform · Shell · TabBar
 *
 * Algorithm 1 (DESIGN_SYSTEM §7). The module's main and team tabs in a row,
 * its Company tabs behind one `Company` menu, and whatever does not fit behind
 * `More`. Below 540px the whole row becomes one section picker.
 *
 * Every tab, the `More` button, the `Company` button and the role note are
 * drawn once more in an invisible copy, measured there, and handed to
 * `fitTabs`. Measuring the copy rather than the visible row is what lets the
 * row be correct on its first paint: a row measured against itself has to be
 * drawn wrong once to discover it does not fit.
 *
 * These are links between screens, not tabs over panels, so they are a `nav`
 * of links with `aria-current="page"`, and arrow keys move between them.
 * In-screen sub-tabs (the card's Overview, Personal, ...) are real tablists.
 */

import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { fitTabs } from "./fit";
import { tabSearch, type ShellModule, type ShellTab } from "./model";
import { NavPanel, type NavPanelGroup } from "./NavPanel";
import { useSize } from "./useSize";

const TAB =
  "flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 pt-2.5 pb-2 text-nav font-medium whitespace-nowrap group-data-[short=true]/stage:min-h-9 group-data-[short=true]/stage:px-2.5";

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="rounded-full bg-destructive px-1.5 font-mono text-table-header leading-normal text-destructive-foreground tabular-nums">
      {n}
    </span>
  );
}

export function hiddenNote(n: number) {
  return `${n} ${n === 1 ? "tab" : "tabs"} hidden for this role`;
}

export function TabBar({
  module,
  activeTabId,
  forceWidth,
}: {
  module: ShellModule;
  activeTabId: string | null;
  /** Test seam: the bar width to fit against, where layout cannot be measured. */
  forceWidth?: number;
}) {
  const bar = useRef<HTMLElement | null>(null);
  const [barEl, setBarEl] = useState<HTMLElement | null>(null);
  const copy = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const companyRef = useRef<HTMLButtonElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<"more" | "company" | "pick" | null>(null);
  const measured = useSize(barEl).width;
  const barWidth = forceWidth ?? measured;

  const rowTabs = module.tabs.filter((t) => t.group !== "company");
  const companyTabs = module.tabs.filter((t) => t.group === "company");
  const active = module.tabs.find((t) => t.id === activeTabId) ?? null;

  const [widths, setWidths] = useState<{
    tabs: number[];
    more: number;
    company: number;
    note: number | null;
  }>({
    tabs: [],
    more: 0,
    company: 0,
    note: null,
  });

  // Re-measured whenever anything that changes a width changes. `useSize`
  // also fires when Plex finishes loading, which changes every width at once.
  useLayoutEffect(() => {
    const el = copy.current;
    if (!el) return;
    const w = (sel: string) => el.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0;
    setWidths({
      tabs: Array.from(el.querySelectorAll<HTMLElement>("[data-tab]")).map((t) => t.offsetWidth),
      more: w("[data-more]"),
      company: companyTabs.length ? w("[data-company]") + 15 : 0, // + separator and margins
      note: module.hiddenForRole ? w("[data-note]") : null,
    });
  }, [module, barWidth, companyTabs.length]);

  const fit = useMemo(
    () =>
      fitTabs({
        barWidth,
        tabWidths: widths.tabs.length === rowTabs.length ? widths.tabs : rowTabs.map(() => 0),
        activeIndex: rowTabs.findIndex((t) => t.id === activeTabId),
        fixedWidth: widths.company,
        moreWidth: widths.more,
        roleNoteWidth: widths.note,
        badges: rowTabs.map((t) => t.badge ?? 0),
      }),
    [barWidth, widths, rowTabs, activeTabId],
  );

  // Closed on any navigation or module change. A menu left open over the page
  // somebody just asked for swallows their next tap on a touchscreen.
  useEffect(() => setOpen(null), [activeTabId, module.key]);

  const asItem = (t: ShellTab) => ({
    key: t.id,
    label: t.label,
    to: t.to,
    search: tabSearch(t),
    description: t.description,
    badge: t.badge,
    current: t.id === activeTabId,
    soon: t.soon,
  });

  const link = (t: ShellTab) =>
    t.soon ? (
      <span
        key={t.id}
        className={cn(TAB, "border-transparent text-muted-foreground")}
        title={`Arrives ${t.soon}`}
      >
        {t.label}
        <span className="text-2xs tracking-wide uppercase">soon</span>
      </span>
    ) : (
      <Link
        key={t.id}
        to={t.to}
        search={tabSearch(t) as never}
        aria-current={t.id === activeTabId ? "page" : undefined}
        data-testid={`tab-${t.id}`}
        className={cn(
          TAB,
          t.id === activeTabId
            ? "border-primary font-semibold text-primary"
            : "border-transparent text-foreground-secondary hover:text-foreground",
        )}
      >
        {t.label}
        <Badge n={t.badge} />
      </Link>
    );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const links = Array.from(
      bar.current?.querySelectorAll<HTMLElement>("[data-testid^=tab-],[data-menu]") ?? [],
    );
    const i = links.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    links[(i + (e.key === "ArrowRight" ? 1 : -1) + links.length) % links.length]?.focus();
  };

  const main = rowTabs.filter((t) => t.group === "main");
  const team = rowTabs.filter((t) => t.group === "team");
  const pickGroups: NavPanelGroup[] = [
    { heading: module.name, items: main.map(asItem) },
    ...(team.length ? [{ heading: "For your team", items: team.map(asItem) }] : []),
    ...(companyTabs.length ? [{ heading: "Company", items: companyTabs.map(asItem) }] : []),
  ];
  const totalBadge = module.tabs.reduce((s, t) => s + (t.badge ?? 0), 0);

  return (
    <nav
      ref={(el) => {
        bar.current = el;
        setBarEl(el);
      }}
      aria-label={`${module.name} sections`}
      onKeyDown={onKeyDown}
      data-mode={fit.mode}
      className={cn(
        "relative z-20 flex items-stretch gap-0.5 border-b border-border bg-card",
        fit.mode === "pick" ? "px-3.5 py-2" : "px-3.5",
      )}
    >
      {/* The measuring copy: every element whose width the fit depends on. */}
      {/* Clipped: an invisible element still widens the page's scroll area, and
          this copy is wider than a phone by design. Inside a zero-overflow box
          it keeps its natural width for measuring and adds none to the page. */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={copy} className="absolute top-0 left-0 flex w-max whitespace-nowrap">
          {rowTabs.map((t) => (
            <span key={t.id} data-tab className={cn(TAB, "font-semibold")}>
              {t.label}
              <Badge n={t.badge} />
            </span>
          ))}
          <span data-more className={TAB}>
            More <span className="px-1.5 font-mono text-table-header">99</span>
            <ChevronDown className="size-3" />
          </span>
          <span data-company className={TAB}>
            Company <span className="px-1.5 font-mono text-table-header">{companyTabs.length}</span>
            <ChevronDown className="size-3" />
          </span>
          <span data-note className="px-2 text-caption">
            {hiddenNote(module.hiddenForRole)}
          </span>
        </div>
      </div>

      {fit.mode === "pick" ? (
        <div className="relative w-full">
          <button
            ref={pickRef}
            type="button"
            data-menu
            aria-expanded={open === "pick"}
            aria-controls="tab-pick"
            onClick={() => setOpen(open === "pick" ? null : "pick")}
            data-testid="tab-picker"
            className="flex min-h-12 w-full items-center gap-2 rounded-md border border-border-strong bg-card px-3 text-left text-nav font-semibold hover:bg-muted"
          >
            <span className="text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
              Section
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="min-w-0 truncate text-primary">{active?.label ?? module.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-caption font-medium text-muted-foreground">
              {module.tabs.length} {module.tabs.length === 1 ? "section" : "sections"}
              <Badge n={totalBadge} />
              <ChevronRight className="size-4" aria-hidden />
            </span>
          </button>
          <NavPanel
            id="tab-pick"
            open={open === "pick"}
            onClose={() => setOpen(null)}
            trigger={pickRef}
            full
            groups={pickGroups}
            footer={module.hiddenForRole ? hiddenNote(module.hiddenForRole) : undefined}
          />
        </div>
      ) : (
        <>
          {rowTabs.map((t, i) => (fit.visible[i] ? link(t) : null))}

          {fit.showMore && (
            <div className="relative flex">
              <button
                ref={moreRef}
                type="button"
                data-menu
                aria-expanded={open === "more"}
                aria-controls="tab-more"
                onClick={() => setOpen(open === "more" ? null : "more")}
                data-testid="tab-more"
                className={cn(
                  TAB,
                  "border-transparent text-foreground-secondary hover:text-foreground",
                )}
              >
                More
                {fit.moreBadge > 0 ? (
                  <Badge n={fit.moreBadge} />
                ) : (
                  <span className="rounded-full bg-surface3 px-1.5 font-mono text-table-header text-foreground-secondary">
                    {fit.moreCount}
                  </span>
                )}
                <ChevronDown className="size-3 opacity-70" aria-hidden />
              </button>
              <NavPanel
                id="tab-more"
                open={open === "more"}
                onClose={() => setOpen(null)}
                trigger={moreRef}
                groups={[{ items: rowTabs.filter((_, i) => !fit.visible[i]).map(asItem) }]}
              />
            </div>
          )}

          {companyTabs.length > 0 && (
            <>
              <span aria-hidden className="mx-1.5 my-2.5 w-px shrink-0 bg-border" />
              <div className="relative flex">
                <button
                  ref={companyRef}
                  type="button"
                  data-menu
                  aria-expanded={open === "company"}
                  aria-controls="tab-company"
                  onClick={() => setOpen(open === "company" ? null : "company")}
                  data-testid="tab-company"
                  data-current={active?.group === "company" || undefined}
                  aria-label={
                    active?.group === "company" ? `Company, current: ${active.label}` : undefined
                  }
                  className={cn(
                    TAB,
                    active?.group === "company"
                      ? "border-primary font-semibold text-primary"
                      : "border-transparent text-foreground-secondary hover:text-foreground",
                  )}
                >
                  Company
                  <span
                    className={cn(
                      "rounded-full px-1.5 font-mono text-table-header",
                      active?.group === "company"
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface3 text-foreground-secondary",
                    )}
                  >
                    {companyTabs.length}
                  </span>
                  <ChevronDown className="size-3 opacity-70" aria-hidden />
                </button>
                <NavPanel
                  id="tab-company"
                  open={open === "company"}
                  onClose={() => setOpen(null)}
                  trigger={companyRef}
                  align="right"
                  groups={[{ heading: "Company", items: companyTabs.map(asItem) }]}
                />
              </div>
            </>
          )}

          {fit.showRoleNote && (
            <span
              data-testid="role-note"
              className="ml-auto self-center pl-3 text-caption whitespace-nowrap text-muted-foreground"
            >
              {hiddenNote(module.hiddenForRole)}
            </span>
          )}
        </>
      )}
    </nav>
  );
}

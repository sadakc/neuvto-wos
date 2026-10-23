/**
 * Platform · Shell · PhoneFrame (doc 11, under 600px)
 *
 * The desktop shell is replaced, not adapted. 64px of chrome above the
 * content on every screen and no tab row at any level:
 *
 *   · the app bar: a back arrow, or the avatar at a module's home; the title
 *     menu, the current section's name with a chevron, opening the sheet of
 *     that level's sections; the bell;
 *   · the bottom bar, 80px: the modules, a pill behind the active one;
 *   · the drawer, from the avatar: the company, the person, the theme;
 *   · a module's home: the tiles for its other sections above the home's own
 *     content, and one Company tile that opens the sheet at Company.
 *
 * Every list is built from the same shell model the desktop tabs are, so a
 * section the person may not open is absent from all of them at once.
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tabSearch, type ShellModule, type ShellTab } from "./model";
import { homeTiles, moduleHome, sectionGroups } from "./phone";
import { useDeclaredSubNav } from "./phone-context";
import { hiddenNote } from "./TabBar";

export function PhoneFrame({
  modules,
  module,
  tab,
  brand,
  trailing,
  drawer,
  initials,
  children,
}: {
  modules: readonly ShellModule[];
  module: ShellModule;
  tab: ShellTab | null;
  brand: ReactNode;
  /** At most two icons at the app bar's right (the bell). */
  trailing?: ReactNode;
  /** The drawer's own controls under the modules (theme, sign-in, sign out). */
  drawer?: ReactNode;
  initials: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const sub = useDeclaredSubNav();
  const [sheet, setSheet] = useState<null | "module" | "sub">(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lines, setLines] = useState<Record<string, string>>({});

  const home = moduleHome(module);
  const inSub = !!sub && sub.current !== "";
  const atHome = !!home && tab?.id === home.id;
  const showHub = atHome && !inSub;

  // The tiles' live lines, read once per module visited (11.3).
  useEffect(() => {
    let cancelled = false;
    setLines({});
    module
      .tileLines?.(null)
      .then((l) => !cancelled && setLines(l))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [module]);

  const title = inSub
    ? (sub!.items.find((i) => i.id === sub!.current)?.label ?? sub!.title)
    : (tab?.label ?? module.name);
  const subtitle = inSub ? sub!.title : module.name;

  function back() {
    if (inSub) sub!.clear();
    else if (home) void navigate({ to: home.to, search: tabSearch(home) as never });
  }

  function go(t: ShellTab) {
    setSheet(null);
    // Sideways within a level replaces the history entry, so back from a
    // section reached through the menu lands on the level's home (11.2).
    void navigate({ to: t.to, search: tabSearch(t) as never, replace: !atHome });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background" data-shell="phone">
      <header
        data-testid="app-bar"
        className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-1 border-b border-border bg-card px-1"
      >
        {showHub || (!inSub && !home) ? (
          <button
            type="button"
            data-testid="app-bar-avatar"
            aria-label="Open the menu"
            onClick={() => setDrawerOpen(true)}
            className="grid size-12 shrink-0 place-items-center rounded-full"
          >
            <span className="grid size-8 place-items-center rounded-full border border-info-line bg-info-muted text-caption font-semibold text-info">
              {initials}
            </span>
          </button>
        ) : (
          <button
            type="button"
            data-testid="app-bar-back"
            aria-label="Back"
            onClick={back}
            className="grid size-12 shrink-0 place-items-center rounded-full text-foreground hover:bg-muted"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          data-testid="title-menu"
          aria-haspopup="dialog"
          aria-expanded={sheet !== null}
          onClick={() => setSheet(inSub ? "sub" : "module")}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left hover:bg-muted"
        >
          <span className="min-w-0">
            <span className="block truncate text-bar-title leading-tight font-semibold tracking-bar-title">
              {title}
            </span>
            <span className="block truncate text-caption text-muted-foreground">{subtitle}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
        <div className="flex shrink-0 items-center">{trailing}</div>
      </header>

      <main className="app-screen @container/screen w-full min-w-0 flex-1 px-4 pt-4 pb-[104px]">
        {showHub && (
          <Hub
            module={module}
            lines={lines}
            onCompany={() => setSheet("module")}
            homeLabel={home!.label}
          />
        )}
        {children}
      </main>

      <BottomNav modules={modules} activeKey={module.key} />

      <BottomSheet
        open={sheet === "module"}
        onOpenChange={(o) => setSheet(o ? "module" : null)}
        title={module.name}
        testId="section-sheet"
        footer={module.hiddenForRole ? hiddenNote(module.hiddenForRole) : undefined}
      >
        {sectionGroups(module).map((g) => (
          <SheetGroupList key={g.heading} heading={g.heading}>
            {g.tabs.map((t) =>
              t.soon ? (
                <li key={t.id}>
                  <span className="flex min-h-[52px] items-center px-4 text-sm text-muted-foreground">
                    {t.label} · {t.soon}
                  </span>
                </li>
              ) : (
                <li key={t.id}>
                  <SheetRow
                    label={t.label}
                    hint={t.description}
                    badge={t.badge}
                    current={t.id === tab?.id}
                    onClick={() => go(t)}
                    testId={`sheet-${t.id}`}
                  />
                </li>
              ),
            )}
          </SheetGroupList>
        ))}
      </BottomSheet>

      {sub && (
        <BottomSheet
          open={sheet === "sub"}
          onOpenChange={(o) => setSheet(o ? "sub" : null)}
          title={sub.title}
          testId="section-sheet"
        >
          {groupItems(sub.items, sub.title).map((g) => (
            <SheetGroupList key={g.heading} heading={g.heading}>
              {g.items.map((i) => (
                <li key={i.id}>
                  <SheetRow
                    label={i.label}
                    hint={i.hint}
                    badge={i.badge}
                    current={i.id === sub.current}
                    onClick={() => {
                      setSheet(null);
                      sub.select(i.id);
                    }}
                    testId={`sheet-${i.id}`}
                  />
                </li>
              ))}
            </SheetGroupList>
          ))}
        </BottomSheet>
      )}

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} brand={brand}>
        <nav aria-label="Modules">
          <ul className="flex flex-col gap-0.5">
            {modules.map((m) => {
              const h = moduleHome(m);
              if (!h) return null;
              const Icon = m.icon;
              return (
                <li key={m.key}>
                  <Link
                    to={h.to}
                    search={tabSearch(h) as never}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={m.key === module.key ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm",
                      m.key === module.key
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    {Icon && <Icon className="size-5" />}
                    {m.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {drawer && <div className="mt-4 border-t border-border pt-4">{drawer}</div>}
      </Drawer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ the home's tiles

function Hub({
  module,
  lines,
  onCompany,
  homeLabel,
}: {
  module: ShellModule;
  lines: Record<string, string>;
  onCompany: () => void;
  homeLabel: string;
}) {
  const { tiles, company } = homeTiles(module);
  if (tiles.length === 0 && company === 0) return null;
  return (
    <section data-testid="hub" aria-label="What do you want to do" className="mb-5">
      <p className="mb-2 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
        What do you want to do
      </p>
      <ul className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <li key={t.id} className="min-w-0">
            <Link
              to={t.to}
              search={tabSearch(t) as never}
              data-testid={`tile-${t.id}`}
              className="relative flex h-full min-h-[104px] flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3.5 shadow-card hover:border-primary"
            >
              <span className="text-sm leading-snug font-semibold">{t.label}</span>
              <span className="text-caption leading-snug text-muted-foreground">
                {lines[t.to] ?? t.description ?? ""}
              </span>
              {t.badge ? (
                <span className="absolute top-3 right-3 inline-flex min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-caption font-semibold text-destructive-foreground">
                  {t.badge}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
        {company > 0 && (
          <li className="col-span-2">
            <button
              type="button"
              data-testid="tile-company"
              onClick={onCompany}
              className="flex min-h-14 w-full items-center justify-between rounded-xl border border-border bg-card px-3.5 text-left shadow-card hover:border-primary"
            >
              <span>
                <span className="block text-sm font-semibold">Company</span>
                <span className="block text-caption text-muted-foreground">
                  {company} {company === 1 ? "section" : "sections"} for administrators
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </button>
          </li>
        )}
      </ul>
      <p className="mt-4 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
        {homeLabel}
      </p>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════ the bottom bar

function BottomNav({ modules, activeKey }: { modules: readonly ShellModule[]; activeKey: string }) {
  const shown = modules.filter((m) => moduleHome(m)).slice(0, 5);
  return (
    <nav
      aria-label="Modules"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-30 flex h-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {shown.map((m) => {
        const h = moduleHome(m)!;
        const active = m.key === activeKey;
        const Icon = m.icon;
        const badge = m.tabs.reduce((s, t) => s + (t.badge ?? 0), 0);
        return (
          <Link
            key={m.key}
            to={h.to}
            search={tabSearch(h) as never}
            aria-current={active ? "page" : undefined}
            data-testid={`bottom-${m.key}`}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1"
          >
            <span
              className={cn(
                "relative grid h-8 w-14 place-items-center rounded-full",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}
            >
              {Icon && <Icon className="size-5" />}
              {badge > 0 && (
                <span className="absolute -top-1 right-1 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[0.6875rem] leading-[1.125rem] font-semibold text-destructive-foreground">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span
              className={cn(
                "max-w-full truncate px-0.5 text-[0.6875rem] leading-tight",
                active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {m.short}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════ sheets

/** The phone's bottom sheet: 18px top corners, a handle, scrolls inside past 78%. */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  testId,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  testId?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid={testId}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[78dvh] flex-col rounded-t-[18px] border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-lg data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
          <div className="flex shrink-0 items-center justify-between pr-1 pl-4">
            <DialogPrimitive.Title className="text-card-title font-semibold tracking-card-title">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close"
              className="grid size-12 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 overflow-y-auto pb-3">{children}</div>
          {footer && (
            <p
              data-testid="sheet-footer"
              className="shrink-0 border-t border-border px-4 py-3 text-caption text-muted-foreground"
            >
              {footer}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetGroupList({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="pt-2">
      <p className="px-4 pb-1 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
        {heading}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function SheetRow({
  label,
  hint,
  badge,
  current,
  onClick,
  testId,
}: {
  label: string;
  hint?: string;
  badge?: number;
  current: boolean;
  onClick: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left",
        current ? "bg-accent text-accent-foreground" : "hover:bg-muted",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", current && "font-semibold")}>{label}</span>
        {hint && <span className="block text-caption text-muted-foreground">{hint}</span>}
      </span>
      {badge ? (
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-caption font-semibold text-destructive-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function groupItems<T extends { group?: string }>(items: T[], fallback: string) {
  const order: string[] = [];
  const by = new Map<string, T[]>();
  for (const i of items) {
    const g = i.group ?? fallback;
    if (!by.has(g)) {
      by.set(g, []);
      order.push(g);
    }
    by.get(g)!.push(i);
  }
  return order.map((heading) => ({ heading, items: by.get(heading)! }));
}

// ═══════════════════════════════════════════════════════════ the drawer

function Drawer({
  open,
  onOpenChange,
  brand,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="drawer"
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col overflow-y-auto border-r border-border bg-card p-3 shadow-lg data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
        >
          <div className="flex items-center justify-between gap-2 pb-3">
            <DialogPrimitive.Title asChild>
              <div className="min-w-0">{brand}</div>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close the menu"
              className="grid size-12 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

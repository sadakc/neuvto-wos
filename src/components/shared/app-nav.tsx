/**
 * The destinations in the scope you are currently in.
 *
 * This file used to resolve navigation itself: the platform's own entries,
 * merged with every enabled module's, in one list. That list was the whole
 * workspace at once — Dashboard, Apply, My leave, Calendar, Pay runs, Payslips,
 * Approvals, People, Reports, Approval rules, Configurations — and it grew by three
 * every time a module shipped.
 *
 * It is now handed one scope's items and renders them. Which scope that is, is
 * decided by the URL and offered by the switcher in the header. `mergeNavItems`
 * is gone with the flat list it interleaved.
 *
 * What a person can see is still decided from their roles and enforced for real
 * by RLS. Hiding a link is presentation, not security — the database refuses the
 * data either way.
 *
 * Mobile shows a bottom tab bar (employee views are mobile-first); desktop shows
 * a sidebar (admin work is desktop-first). Destinations that are not built yet
 * are rendered as visibly unavailable rather than as links to nothing.
 */

import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ModuleNavItem } from "@/platform/modules";
import { MAX_VISIBLE_TABS } from "@/platform/design/tokens";
import { cn } from "@/lib/utils";

/**
 * One tab. `h-14` is 56px — comfortably over the 48px minimum touch target,
 * with the extra going to the safe area above the home indicator.
 */
const TAB = "flex h-14 flex-1 items-center justify-center px-1 text-xs font-medium";

type NavItem = ModuleNavItem;

/**
 * Splits the destinations into the ones on the bar and the ones behind "More".
 *
 * The bar used to be `items.slice(0, 5)` — everything past the fifth was not
 * moved anywhere, it was **deleted from the interface**. An administrator on a
 * phone had no route to Approval rules or Configurations at all, and nothing on
 * screen suggested anything was missing. That is the failure mode this guards:
 * silent truncation reads as "that feature doesn't exist".
 *
 * Scoping the shell makes an overflowing bar much less likely — no single scope
 * carries the whole workspace any more — but this stays, and stays tested. A cap
 * respected only because nothing currently exceeds it is a cap nobody is
 * enforcing, and the organisation scope still hands an administrator six.
 *
 * `MAX_VISIBLE_TABS` is five because iOS caps a `UITabBar` at five and spills
 * the rest into its own "More" — matching it means the web and the eventual
 * native app break at the same place, so somebody who uses both is not learning
 * two navigations.
 *
 * The arithmetic worth stating: with six items you show FOUR plus "More", not
 * five, because "More" occupies a slot. Off by one here and the sixth item
 * vanishes again — which is the original bug wearing a hat.
 */
export function splitNavItems(items: NavItem[]): { visible: NavItem[]; overflow: NavItem[] } {
  if (items.length <= MAX_VISIBLE_TABS) return { visible: items, overflow: [] };
  return {
    visible: items.slice(0, MAX_VISIBLE_TABS - 1),
    overflow: items.slice(MAX_VISIBLE_TABS - 1),
  };
}

export function AppNav({ items }: { items: readonly NavItem[] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();

  const { visible, overflow } = splitNavItems([...items]);
  const overflowIsActive = overflow.some((i) => i.to === pathname);

  // Closed on navigation. Without this the sheet stays open over the page the
  // person just asked for, and on iOS the backdrop swallows the first tap they
  // make to get rid of it.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop — sidebar */}
      <nav
        aria-label="Main"
        data-print="hide"
        className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border p-4 md:flex"
      >
        {items.map((item) =>
          item.to ? (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.to
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              title={`Arrives in ${item.soon}`}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60"
            >
              {item.label}
              <span className="text-2xs uppercase tracking-wide">soon</span>
            </span>
          ),
        )}
      </nav>

      {/* Mobile — bottom tabs. 48px targets per the design system. */}
      <nav
        aria-label="Main"
        data-print="hide"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-background md:hidden"
      >
        {visible.map((item) =>
          item.to ? (
            <Link
              key={item.label}
              to={item.to}
              className={cn(TAB, pathname === item.to ? "text-primary" : "text-muted-foreground")}
            >
              {item.label}
            </Link>
          ) : (
            <span key={item.label} className={cn(TAB, "text-muted-foreground/50")}>
              {item.label}
            </span>
          ),
        )}

        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="nav-more"
            data-testid="nav-more"
            className={cn(
              TAB,
              overflowIsActive || moreOpen ? "text-primary" : "text-muted-foreground",
            )}
          >
            More
          </button>
        )}
      </nav>

      {/* The overflow sheet. Rendered as a sibling of the bar rather than inside
          it so it is not clipped by the bar's own height, and dismissed by the
          backdrop as well as by choosing something — a menu with no way out
          except the right answer is a trap on a touchscreen. */}
      {moreOpen && overflow.length > 0 && (
        <div className="fixed inset-0 z-20 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-ink/60"
          />
          <div
            id="nav-more"
            className="absolute inset-x-0 bottom-14 border-t border-border bg-popover p-2 pb-3"
          >
            {overflow.map((item) =>
              item.to ? (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex h-12 items-center rounded-md px-4 text-sm font-medium",
                    pathname === item.to ? "bg-secondary text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  className="flex h-12 items-center justify-between rounded-md px-4 text-sm text-muted-foreground/60"
                >
                  {item.label}
                  <span className="text-2xs uppercase tracking-wide">soon</span>
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}

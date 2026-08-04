/**
 * Role-aware navigation.
 *
 * What a person can see is decided from their roles, and enforced for real by
 * RLS in the database. Hiding a link is presentation, not security — the
 * database refuses the data either way.
 *
 * **This file knows about no module.** It used to hardcode "Apply", "My leave",
 * "Calendar" and "Approvals", which meant changing Leave meant editing a shared
 * file, and every future module would have added its own line here. Module
 * destinations now come from the manifests of whatever the organisation has
 * switched on; this file contributes only the two entries the platform itself
 * owns.
 *
 * Mobile shows a bottom tab bar (employee views are mobile-first); desktop shows
 * a sidebar (admin work is desktop-first). Destinations that are not built yet
 * are rendered as visibly unavailable rather than as links to nothing.
 */

import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { CurrentUser } from "@/platform/auth";
import { isAdmin } from "@/platform/auth";
import { getModuleNavigation, type ModuleNavItem } from "@/platform/modules";
import { MAX_VISIBLE_TABS } from "@/platform/design/tokens";
import { cn } from "@/lib/utils";

/**
 * One tab. `h-14` is 56px — comfortably over the 48px minimum touch target,
 * with the extra going to the safe area above the home indicator.
 */
const TAB = "flex h-14 flex-1 items-center justify-center px-1 text-xs font-medium";

type NavItem = ModuleNavItem;

/**
 * The platform's own destinations. Dashboard is the shell; Settings configures
 * the organisation, not any one module. Everything else is contributed.
 */
export function platformNavItems(user: CurrentUser | null): NavItem[] {
  const items: NavItem[] = [{ label: "Dashboard", to: "/app" }];

  // Approvals is the platform's, not Leave's — and it used to be Leave's, sitting
  // in that manifest as `{ label: "Approvals", soon: "step 8" }`. A module
  // claiming this screen would have meant a manager running two modules visiting
  // two queues to find out what they were holding up. One queue lists everything
  // waiting on you; each module renders its own rows through `approvalViews`.
  //
  // Managers are not administrators, so this cannot hang off isAdmin().
  if (user?.roles.some((r) => r === "manager" || r === "hr_admin" || r === "org_admin")) {
    items.push({ label: "Approvals", to: "/app/approvals" });
  }

  if (isAdmin(user)) {
    // People and Approval rules are platform concerns, not Leave's: who is in
    // the workspace and who signs things off are the same questions whatever
    // modules are switched on.
    items.push({ label: "People", to: "/app/members" });
    // Reports is a PLATFORM destination that modules fill, not Leave's own.
    //
    // Not merely tidiness. A module nav item lands at position 2–4 (see
    // mergeNavItems), and the mobile bar shows the first five — so a fourth
    // Leave entry would push "Approvals" off the bar for an administrator,
    // which is exactly what the team calendar did in step 10. Here it sits
    // sixth and falls off deliberately: admin work is desktop-first, and the
    // sidebar shows everything.
    items.push({ label: "Reports", to: "/app/reports" });
    items.push({ label: "Approval rules", to: "/app/approval-rules" });
    items.push({ label: "Settings", to: "/app/settings" });
  }
  return items;
}

/**
 * Dashboard, then whatever the modules contribute, then the admin destinations.
 *
 * Order matters more than it looks: the mobile bar shows the first FIVE items
 * and nothing else. Putting the admin items before the module ones pushed
 * "Apply" and "My leave" off the bar entirely for an administrator — who is also
 * an employee, and whose own leave is the thing they reach for most. Admin work
 * is desktop-first; the sidebar shows everything either way.
 */
export function mergeNavItems(platform: NavItem[], modules: NavItem[]): NavItem[] {
  const dashboardIndex = platform.findIndex((i) => i.to === "/app");
  if (dashboardIndex === -1) return [...platform, ...modules];
  return [
    ...platform.slice(0, dashboardIndex + 1),
    ...modules,
    ...platform.slice(dashboardIndex + 1),
  ];
}

/**
 * Splits the destinations into the ones on the bar and the ones behind "More".
 *
 * The bar used to be `items.slice(0, 5)` — everything past the fifth was not
 * moved anywhere, it was **deleted from the interface**. An administrator on a
 * phone had no route to Approval rules or Settings at all, and nothing on
 * screen suggested anything was missing. That is the failure mode this guards:
 * silent truncation reads as "that feature doesn't exist".
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

export function AppNav({ user }: { user: CurrentUser | null }) {
  const [moduleItems, setModuleItems] = useState<NavItem[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    // A module's navigation depends on which modules the organisation has
    // enabled, which is a database read. Failing quietly to the platform's own
    // items is deliberate: a navigation hiccup must not blank the shell.
    getModuleNavigation(user)
      .then((items) => {
        if (!cancelled) setModuleItems(items);
      })
      .catch(() => {
        if (!cancelled) setModuleItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const items = mergeNavItems(platformNavItems(user), moduleItems);
  const { visible, overflow } = splitNavItems(items);
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

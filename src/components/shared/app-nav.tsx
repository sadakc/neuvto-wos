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
import { cn } from "@/lib/utils";

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

export function AppNav({ user }: { user: CurrentUser | null }) {
  const [moduleItems, setModuleItems] = useState<NavItem[]>([]);
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
              <span className="text-[0.65rem] uppercase tracking-wide">soon</span>
            </span>
          ),
        )}
      </nav>

      {/* Mobile — bottom tabs. 48px targets per the design system. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-background md:hidden"
      >
        {items.slice(0, 5).map((item) =>
          item.to ? (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                "flex h-14 flex-1 items-center justify-center px-1 text-xs font-medium",
                pathname === item.to ? "text-primary" : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              className="flex h-14 flex-1 items-center justify-center px-1 text-xs text-muted-foreground/50"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
    </>
  );
}

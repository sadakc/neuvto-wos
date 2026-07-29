/**
 * Role-aware navigation.
 *
 * What a person can see is decided here from their roles, and enforced for real
 * by RLS in the database. Hiding a link is presentation, not security — the
 * database refuses the data either way.
 *
 * Mobile shows a bottom tab bar (employee views are mobile-first); desktop shows
 * a sidebar (admin work is desktop-first). Destinations that are not built yet
 * are rendered as visibly unavailable rather than as links to nothing.
 */

import { Link, useLocation } from "@tanstack/react-router";
import type { CurrentUser } from "@/platform/auth";
import { canApprove, isAdmin } from "@/platform/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  to?: string;
  /** Which build step delivers this, when it isn't here yet. */
  soon?: string;
}

export function navItemsFor(user: CurrentUser | null): NavItem[] {
  const items: NavItem[] = [
    { label: "Dashboard", to: "/app" },
    { label: "Apply", soon: "step 7" },
    { label: "My leave", soon: "step 7" },
    { label: "Calendar", soon: "step 7" },
  ];

  if (canApprove(user)) {
    items.push({ label: "Approvals", soon: "step 8" }, { label: "Team", soon: "step 8" });
  }

  if (isAdmin(user)) {
    items.push({ label: "Settings", to: "/app/settings" });
  }

  return items;
}

export function AppNav({ user }: { user: CurrentUser | null }) {
  const items = navItemsFor(user);
  const { pathname } = useLocation();

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

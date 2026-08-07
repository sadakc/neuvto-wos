import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import {
  getCurrentUser,
  isAdmin,
  canApprove,
  ROLE_LABELS,
  type CurrentUser,
} from "@/platform/auth";
import { getDashboardCards, type ModuleDashboardCard } from "@/platform/modules";

export const Route = createFileRoute("/app/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Dashboard — Neuvto WOS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [cards, setCards] = useState<(ModuleDashboardCard & { moduleKey: string })[]>([]);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // Contributed by whatever modules this organisation has enabled. This file
  // names none of them — it used to hardcode a Leave Management panel, which is
  // the coupling the module contract exists to remove.
  useEffect(() => {
    let cancelled = false;
    getDashboardCards(user)
      .then((c) => {
        if (!cancelled) setCards(c);
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-xl font-semibold tracking-tight">
        {user?.fullName ? `Welcome, ${user.fullName.split(" ")[0]}` : "Welcome"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {user?.roles.length
          ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")
          : "Loading your access…"}
      </p>

      {cards.length > 0 ? (
        <div className="mt-8 space-y-4">
          {cards.map((card) => {
            const Card = card.component;
            return (
              <Suspense
                key={`${card.moduleKey}:${card.id}`}
                fallback={<div className="h-28 animate-pulse rounded-lg bg-muted" />}
              >
                <Card />
              </Suspense>
            );
          })}
        </div>
      ) : (
        /* Honest about being empty rather than showing placeholder numbers.
           This is also the state the application is in when every module has
           been removed, which the module-removal check exercises. */
        <section className="mt-8 rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-base font-semibold">Nothing here yet</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            No modules are switched on for {user?.organizationName ?? "your workspace"} yet. An
            administrator turns them on, and what you can do here appears.
          </p>
        </section>
      )}

      {/*
        Real links, not a sentence naming a destination.

        The mobile bar shows the FIRST FIVE items and nothing else, and the
        sidebar is desktop-only — so once People and Approval rules were added,
        an administrator on a phone had no route to any of them. Found by
        looking at the bottom bar on a 321px viewport, which is the width Sada
        actually tests on.

        Keeping these here rather than juggling the tab bar: the five tabs an
        employee needs are the right five, and admin work wants a wider screen
        anyway. What it must not be is unreachable.
      */}
      {isAdmin(user) && (
        <section className="mt-8 border-t border-border pt-6">
          <h2 className="text-sm font-medium">Administration</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { to: "/app/settings", label: "Settings" },
              { to: "/app/members", label: "People" },
              { to: "/app/approval-rules", label: "Approval rules" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm font-medium"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      )}
      {!isAdmin(user) && canApprove(user) && (
        <p className="mt-6 text-sm text-muted-foreground">
          Requests from your team will appear under{" "}
          <span className="text-foreground">Approvals</span>.
        </p>
      )}
    </div>
  );
}

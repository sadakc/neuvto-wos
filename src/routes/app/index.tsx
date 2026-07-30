import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { getCurrentUser, isAdmin, canApprove, type CurrentUser } from "@/platform/auth";
import { getDashboardCards, type ModuleDashboardCard } from "@/platform/modules";

export const Route = createFileRoute("/app/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Dashboard — Neuvto WOS" }] }),
  component: Dashboard,
});

const ROLE_LABELS: Record<string, string> = {
  org_admin: "Administrator",
  hr_admin: "HR administrator",
  manager: "Manager",
  employee: "Employee",
};

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

      {isAdmin(user) && (
        <p className="mt-6 text-sm text-muted-foreground">
          As an administrator you can review your workspace configuration in{" "}
          <span className="text-foreground">Settings</span>.
        </p>
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

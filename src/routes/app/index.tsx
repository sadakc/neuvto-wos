import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, isAdmin, canApprove, type CurrentUser } from "@/platform/auth";

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

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

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

      {/* Honest empty state: the module is enabled but not built. Saying so is
          better than a fake dashboard with placeholder numbers on it. */}
      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-base font-semibold">Leave Management</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Enabled for {user?.organizationName ?? "your workspace"}, and being built now. Applying
          for leave and approvals arrive in the next steps; balances follow once the leave module
          lands.
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { term: "Employees", detail: "Import arrives with member management" },
            { term: "Leave types", detail: "Configurable per organisation" },
            { term: "Approvals", detail: "Chains are configuration, not code" },
          ].map((item) => (
            <div key={item.term}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{item.term}</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-muted-foreground/50">
                —
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </dl>
      </section>

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

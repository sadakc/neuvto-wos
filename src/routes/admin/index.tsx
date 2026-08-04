import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getUserId,
  isPlatformAdmin,
  listOrganizations,
  listOrganizationModules,
  setOrganizationModule,
  provisionOrganization,
  suggestSlug,
  type CustomerModule,
  type CustomerWorkspace,
  getMailHealth,
  type MailHealth,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { MailHealthBanner } from "@/platform/auth/MailHealthBanner";

export const Route = createFileRoute("/admin/")({
  ssr: false,
  // Deliberately says nothing. The page shows a not-found to anyone who is not
  // staff, and a tab reading "Neuvto — customers" over the top of it would give
  // away both that the route exists and what it does. Caught by loading it
  // signed out and reading the tab.
  head: () => ({ meta: [{ title: "Neuvto" }] }),
  component: AdminConsole,
});

/**
 * Neuvto's own console. Deliberately outside `/app`, which assumes a tenant —
 * a platform admin has no organisation, so the tenant shell has nothing to show
 * them and every tenant policy refuses them by design (D42).
 *
 * What this can do: create a customer workspace and name its first
 * administrator. What it cannot do, at all: read anybody's leave, balances,
 * approvals or employee records. That is not a rule this file enforces — it is
 * what `platform_list_organizations()` returns, and it returns names and counts.
 *
 * Provisioning creates no profile. The named administrator is invited and
 * accepts like everybody else (D39), which means they have proved they control
 * the address before they hold the role.
 */
function AdminConsole() {
  const [mailHealth, setMailHealth] = useState<MailHealth | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [orgs, setOrgs] = useState<CustomerWorkspace[]>([]);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminName, setAdminName] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  // Which customer's modules are open, and what they are. Loaded on demand
  // rather than for every row: the console lists every customer Neuvto has, and
  // fetching each one's module grants up front would be a query per row for
  // information almost nobody is looking at.
  const [modulesFor, setModulesFor] = useState<string | null>(null);
  const [modules, setModules] = useState<CustomerModule[] | null>(null);

  async function load() {
    setOrgs(await listOrganizations());
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Signed out is NOT the same as not staff, and conflating them stranded
      // the one person who is definitely allowed in: Sada opened /admin signed
      // out, got a not-found with no way to sign in, and the only link on it
      // sent him to /app — which has no workspace for a platform admin either.
      //
      // So: no session, go and get one. A session that simply is not staff's
      // still gets the not-found, which is the case that has to disclose
      // nothing.
      const uid = await getUserId().catch(() => null);
      if (cancelled) return;
      if (!uid) {
        window.location.href = `/auth?next=${encodeURIComponent("/admin")}`;
        return;
      }

      const ok = await isPlatformAdmin().catch(() => false);
      if (cancelled) return;
      setAllowed(ok);
      if (!ok) return;

      // Read in parallel and settled separately. The health check must never be
      // able to stop the customer list loading — this is the screen somebody
      // opens because something already seems wrong, and a broken check that
      // blanks the page has made the outage worse rather than visible.
      const [listResult, healthResult] = await Promise.allSettled([load(), getMailHealth()]);
      if (cancelled) return;
      if (listResult.status === "rejected") {
        setLoadError("We couldn't load the customer list.");
      }
      setMailHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function openModules(orgId: string) {
    if (modulesFor === orgId) {
      setModulesFor(null);
      return;
    }
    setModulesFor(orgId);
    setModules(null);
    try {
      setModules(await listOrganizationModules(orgId));
    } catch (e) {
      setError(isAppError(e) ? e.message : "We couldn't load that customer's modules.");
      setModulesFor(null);
    }
  }

  async function toggleModule(orgId: string, key: string, granted: boolean) {
    setError("");
    try {
      await setOrganizationModule(orgId, key, granted);
      setModules(await listOrganizationModules(orgId));
      // The member count is unchanged but the list is the cheapest way to keep
      // everything else honest after a write.
      await load();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That module couldn't be changed.");
    }
  }

  async function onProvision(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await provisionOrganization({
        organizationName: name,
        slug,
        adminEmail,
        adminPhone,
        adminName,
      });
      await load();
      setName("");
      setSlug("");
      setSlugEdited(false);
      setAdminEmail("");
      setAdminPhone("");
      setAdminName("");
    } catch (err) {
      setError(
        isAppError(err)
          ? err.message
          : err instanceof Error && "issues" in err
            ? (err as { issues: { message: string }[] }).issues[0].message
            : "That workspace couldn't be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">Checking…</p>
      </main>
    );
  }

  /*
    The same page a wrong URL gets. Anyone who is not staff should learn nothing
    from this route — including that it exists, or that they were close.
  */
  if (!allowed) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">There&apos;s nothing at this address.</p>
        <a
          href="/app"
          className="mt-8 inline-flex h-12 w-fit items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
        >
          Go to your workspace
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 pb-24">
      <h1 className="font-display text-xl font-semibold tracking-tight">Customers</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Every Neuvto workspace. Creating one invites the administrator you name; they set the
        company up from there.
      </p>

      {/* Before the customer list, because it changes what the list means: a
          workspace provisioned while mail is down has an administrator who was
          never actually invited. */}
      <MailHealthBanner health={mailHealth} />

      {/* ─────────────────────────────────────────────── provision */}
      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="font-display text-base font-semibold">New customer</h2>

        <form onSubmit={onProvision} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="org-name" className="block text-sm font-medium">
                Company name
              </label>
              <input
                id="org-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugEdited) setSlug(suggestSlug(e.target.value));
                }}
                placeholder="Acme Security Services"
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="org-slug" className="block text-sm font-medium">
                Workspace address
              </label>
              <input
                id="org-slug"
                required
                maxLength={63}
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                placeholder="acme"
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lowercase letters, numbers and hyphens
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium">
                Administrator email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="owner@acme.com"
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="admin-phone" className="block text-sm font-medium">
                Phone
              </label>
              <input
                id="admin-phone"
                type="tel"
                value={adminPhone}
                onChange={(e) => setAdminPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="admin-name" className="block text-sm font-medium">
                Their name
              </label>
              <input
                id="admin-name"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Optional"
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>

          {error && (
            <p role="alert" data-testid="provision-error" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            data-testid="provision"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create workspace and invite"}
          </button>
        </form>
      </section>

      {/* ─────────────────────────────────────────────── the list */}
      <section className="mt-10">
        <h2 className="font-display text-base font-semibold">
          {orgs.length} {orgs.length === 1 ? "workspace" : "workspaces"}
        </h2>

        {loadError && <p className="mt-2 text-sm text-destructive">{loadError}</p>}

        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {orgs.map((o) => (
            <li key={o.id} data-testid="customer-row" className="p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{o.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.slug} · {o.memberCount} {o.memberCount === 1 ? "person" : "people"} · since{" "}
                    {new Date(o.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {o.adminEmail
                    ? o.adminAccepted
                      ? `Admin: ${o.adminEmail}`
                      : `Invited: ${o.adminEmail}`
                    : "No administrator invited"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {/* Only while unaccepted, and only so an invitation that never
                    arrived can be handed over another way. */}
                {o.adminInviteUrl && (
                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(o.adminInviteUrl!);
                      setCopied(o.id);
                    }}
                    className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                  >
                    {copied === o.id ? "Copied" : "Copy invitation link"}
                  </button>
                )}
                <button
                  onClick={() => void openModules(o.id)}
                  data-testid="manage-modules"
                  className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                >
                  {modulesFor === o.id ? "Hide modules" : "Modules"}
                </button>
              </div>

              {/*
                What this customer is entitled to. Granting is Neuvto's decision
                and only Neuvto's — a customer's own administrator cannot insert
                an entitlement, which the policy before D44 allowed outright.
                What they CAN do is switch off something they hold, and that
                switch lives in their Settings, not here.
              */}
              {modulesFor === o.id && (
                <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3">
                  {modules === null ? (
                    <div className="h-8 animate-pulse rounded bg-muted" />
                  ) : (
                    <ul className="space-y-2">
                      {modules.map((m) => (
                        <li key={m.key} className="flex items-center justify-between gap-4">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{m.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {m.status === "coming_soon"
                                ? "Not built yet"
                                : m.status === "retired"
                                  ? "Retired — off however this reads"
                                  : m.granted
                                    ? m.enabled
                                      ? "Granted · switched on by the customer"
                                      : "Granted · the customer has it switched off"
                                    : "Not granted"}
                            </span>
                          </span>
                          <button
                            onClick={() => void toggleModule(o.id, m.key, !m.granted)}
                            disabled={m.status !== "available"}
                            data-testid="toggle-module"
                            className="inline-flex h-12 shrink-0 items-center rounded-md border border-border px-3 text-sm disabled:opacity-40"
                          >
                            {m.granted ? "Withdraw" : "Grant"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

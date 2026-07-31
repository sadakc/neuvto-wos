import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getUserId,
  isPlatformAdmin,
  listOrganizations,
  provisionOrganization,
  suggestSlug,
  type CustomerWorkspace,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";

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

      try {
        await load();
      } catch {
        if (!cancelled) setLoadError("We couldn't load the customer list.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

              {/* Only while unaccepted, and only so an invitation that never
                  arrived can be handed over another way. */}
              {o.adminInviteUrl && (
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(o.adminInviteUrl!);
                    setCopied(o.id);
                  }}
                  className="mt-3 inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                >
                  {copied === o.id ? "Copied" : "Copy invitation link"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

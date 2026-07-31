import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, signOut, type CurrentUser } from "@/platform/auth";
import {
  companyName,
  getLogoUrl,
  getOrganization,
  type Organization,
} from "@/platform/organization";
import { isAppError } from "@/platform/errors";
import { AppNav } from "@/components/shared/app-nav";

export const Route = createFileRoute("/app")({
  ssr: false,
  component: AppShell,
});

function AppShell() {
  const navigate = useNavigate();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  // D45. The workspace should look like the customer's, not like ours. Loaded
  // after the user and allowed to fail quietly — a missing logo is a cosmetic
  // problem and must never be why somebody cannot reach their leave.
  const [org, setOrg] = useState<Organization | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((u) => {
        if (cancelled) return;
        if (!u) {
          // Signed out. Preserve where they were headed so they land there.
          const next = encodeURIComponent(window.location.pathname);
          window.location.href = `/auth?next=${next}`;
          return;
        }
        setUser(u);
        setState("ready");

        void getOrganization()
          .then(async (o) => {
            if (cancelled || !o) return;
            setOrg(o);
            setLogoUrl(await getLogoUrl(o.logoPath, o.logoUpdatedAt));
          })
          .catch(() => {});
      })
      .catch((e) => {
        if (cancelled) return;
        // Authenticated but no profile — they never finished signup.
        if (isAppError(e) && e.code === "NO_ORGANIZATION") {
          window.location.href = "/auth";
          return;
        }
        setMessage(isAppError(e) ? e.message : "We couldn't load your workspace.");
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center border-b border-border px-4">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        </header>
        <div className="flex flex-1">
          <div className="hidden w-56 shrink-0 flex-col gap-2 border-r border-border p-4 md:flex">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
          <main className="flex-1 p-6">
            <div className="h-6 w-48 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-24 max-w-md animate-pulse rounded-lg bg-muted" />
          </main>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl && (
            <img
              src={logoUrl}
              alt=""
              aria-hidden
              className="h-8 w-8 shrink-0 rounded object-contain"
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold">
              {companyName(org) || user?.organizationName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={async () => {
            await signOut();
            window.location.href = "/auth";
          }}
          className="inline-flex h-12 shrink-0 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Sign out
        </button>
      </header>

      <div className="flex flex-1">
        <AppNav user={user} />
        {/* pb-20 clears the mobile tab bar. */}
        <main className="min-w-0 flex-1 p-4 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

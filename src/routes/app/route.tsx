import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, signOut, type CurrentUser } from "@/platform/auth";
import {
  companyName,
  getLogoUrl,
  getOrganization,
  onIdentityChange,
  type Organization,
} from "@/platform/organization";
import { isAppError } from "@/platform/errors";
import { getEnabledModules, type ModuleDefinition } from "@/platform/modules";
import { AppFrame, buildShell } from "@/platform/shell";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Building2, House } from "lucide-react";

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

  // The modules this organisation has granted and switched on (D44). Failing
  // quietly to none is deliberate: a navigation hiccup must not blank the
  // shell, and Home still works with every module off.
  const [enabled, setEnabled] = useState<readonly ModuleDefinition[]>([]);
  useEffect(() => {
    let cancelled = false;
    getEnabledModules()
      .then((ms) => !cancelled && setEnabled(ms))
      .catch(() => !cancelled && setEnabled([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // The shell outlives every page inside it, so identity changed under it
  // without it noticing. This is how it hears.
  useEffect(() => {
    const reread = () => {
      void getOrganization()
        .then(async (o) => {
          if (!o) return;
          setOrg(o);
          setLogoUrl(await getLogoUrl(o.logoPath, o.logoUpdatedAt));
        })
        .catch(() => {});
    };
    return onIdentityChange(reread);
  }, []);

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
          // Deliberately NO `next`. Adding one here rebuilds the loop this
          // replaced: `/auth` treats a `next` as intent and follows it, so
          // `next=/app/...` would send a workspaceless platform admin straight
          // back to this shell, which throws NO_ORGANIZATION again. Without it,
          // `/auth` answers with the "you're already signed in" screen and the
          // person has somewhere to go.
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
      // The shape of the Core HR shell, so nothing jumps when it arrives.
      <div className="@container/app flex min-h-dvh bg-background @max-[1000px]/app:flex-col">
        <div className="flex w-[246px] shrink-0 flex-col gap-2 border-r border-border bg-card p-4 @max-[1000px]/app:w-auto @max-[1000px]/app:border-r-0 @max-[1000px]/app:border-b">
          <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-md bg-muted @max-[1000px]/app:hidden"
            />
          ))}
        </div>
        <div className="flex-1">
          <div className="h-14 border-b border-border bg-card" />
          <div className="h-11 border-b border-border bg-card" />
          <main className="p-5">
            <div className="h-6 w-48 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-24 max-w-md animate-pulse rounded-xl bg-muted" />
          </main>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-page-title font-semibold tracking-page-title">
            This didn&apos;t load
          </h1>
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

  const name = companyName(org) || user?.organizationName || "";
  const initials = (user?.fullName || user?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <AppFrame
      modules={buildShell(user, enabled, { home: House, organisation: Building2 })}
      brand={
        // D45. The workspace looks like the customer's: their logo and name,
        // with ours underneath, small.
        <div className="flex items-center gap-2.5">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              aria-hidden
              className="size-[30px] shrink-0 rounded-md object-contain"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-[30px] shrink-0 place-items-center rounded-md bg-primary text-table-cell font-bold text-primary-foreground"
            >
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold tracking-card-title">
              {name}
            </p>
            <p className="truncate font-mono text-caption text-muted-foreground">neuvto</p>
          </div>
        </div>
      }
      actions={
        <>
          <ThemeToggle />
          <button
            onClick={async () => {
              await signOut();
              window.location.href = "/auth";
            }}
            className="inline-flex h-10 shrink-0 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Sign out
          </button>
          <Link
            to="/app/security"
            title={`${user?.email ?? ""} · Sign-in and security`}
            aria-label={`Signed in as ${user?.email ?? ""}. Sign-in and security`}
            className="grid size-[30px] shrink-0 place-items-center rounded-full border border-info-line bg-info-muted text-caption font-semibold text-info hover:border-info"
          >
            {initials}
          </Link>
        </>
      }
    >
      <Outlet />
    </AppFrame>
  );
}

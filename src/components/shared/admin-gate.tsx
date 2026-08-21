/**
 * Resolves the signed-in user and renders only for an administrator.
 *
 * Extracted when settings split into one page per module: the loading skeleton,
 * the "administrators only" refusal and the failed-to-load state were about to
 * be written twice, and two copies of a refusal is how one of them quietly
 * stops refusing.
 *
 * **This is presentation.** It hides a page; it does not protect one. Every
 * screen behind it reads through functions that refuse a non-administrator
 * themselves, because a screen that is merely not linked is not a permission.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getCurrentUser, isAdmin, type CurrentUser } from "@/platform/auth";

export function AdminGate({ children }: { children: (user: CurrentUser) => ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((u) => {
        if (cancelled) return;
        if (!isAdmin(u)) {
          setState("denied");
          return;
        }
        setUser(u);
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("admin gate failed", e);
        setMessage("We couldn't load your settings.");
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace settings are managed by your administrator.
        </p>
      </div>
    );
  }

  if (state === "error" || !user) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  return <>{children(user)}</>;
}

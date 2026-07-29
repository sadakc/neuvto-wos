import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  requestOtp,
  verifyOtp,
  getCurrentUser,
  createOrganization,
  suggestSlug,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Neuvto WOS" },
      { name: "description", content: "Sign in to Neuvto WOS." },
      { property: "og:title", content: "Sign in — Neuvto WOS" },
      { property: "og:description", content: "Sign in to Neuvto WOS." },
    ],
  }),
  component: AuthPage,
});

/** Only same-origin paths, so `?next=` cannot be used as an open redirect. */
function safeNext(next: string) {
  if (!next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

type Step = "email" | "code" | "workspace";

function AuthPage() {
  const { next } = Route.useSearch();
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fullName, setFullName] = useState("");

  // Already signed in with a workspace? Skip the whole flow.
  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (!cancelled && user) window.location.href = safeNext(next);
        else if (!cancelled) setChecking(false);
      })
      .catch(() => {
        // NO_ORGANIZATION lands here: authenticated but signup never finished.
        if (!cancelled) {
          setStep("workspace");
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [next]);

  function fail(e: unknown) {
    toast.error(isAppError(e) ? e.message : "Something went wrong. Please try again.");
  }

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await requestOtp({ email });
      setStep("code");
      toast.success(`We sent a 6-digit code to ${email.trim()}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyOtp({ email, token: code });
      const user = await getCurrentUser().catch(() => null);
      if (user) window.location.href = safeNext(next);
      else setStep("workspace");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createOrganization({ organizationName: orgName, slug, fullName });
      window.location.href = safeNext(next);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      {step === "email" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in to Neuvto</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;ll email you a 6-digit code. No password needed.
          </p>

          <form onSubmit={onRequestCode} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Work email
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Sending code…" : "Email me a code"}
            </button>
          </form>
        </>
      )}

      {step === "code" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Enter your code</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sent to <span className="text-foreground">{email}</span>. It expires shortly.
          </p>

          <form onSubmit={onVerify} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium">
              6-digit code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-center text-base tracking-[0.5em] tabular-nums"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCode("");
                setStep("email");
              }}
              className="h-12 text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Use a different email
            </button>
          </form>
        </>
      )}

      {step === "workspace" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Create your workspace
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;ll be its first administrator.
          </p>

          <form onSubmit={onCreateWorkspace} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Company name
              <input
                required
                autoFocus
                maxLength={200}
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  if (!slugEdited) setSlug(suggestSlug(e.target.value));
                }}
                placeholder="Acme Security Services"
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Workspace address
              <input
                required
                maxLength={63}
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                placeholder="acme"
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Lowercase letters, numbers and hyphens.
              </span>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Your name
              <input
                maxLength={200}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Optional"
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create workspace"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}

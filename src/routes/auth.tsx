import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  requestOtp,
  verifyOtp,
  getCurrentUser,
  acceptInvitation,
  isAdmin,
  isPlatformAdmin,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";

export const Route = createFileRoute("/auth")({
  ssr: false,
  // The return type is annotated so `invite` is OPTIONAL in the route's search
  // type. Inferred, it would be required, and every other place that redirects
  // here — the OAuth consent screen, for one — would have to pass an empty
  // string it knows nothing about.
  validateSearch: (s: Record<string, unknown>): { next: string; invite?: string } => ({
    next: typeof s.next === "string" ? s.next : "",
    invite: typeof s.invite === "string" && s.invite ? s.invite : undefined,
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

/**
 * `workspace` is gone.
 *
 * It used to offer a form: any verified email could create an organisation and
 * become its administrator. That is how a second address of Sada's became an
 * administrator of a workspace nobody meant to exist — isolated and harmless,
 * but the wrong model for a product deployed to named customers. Workspaces are
 * provisioned now (D39), and someone signing in with no workspace and no
 * invitation is told so rather than handed a form.
 *
 * `joining` is where an invited person lands: the link identified the
 * invitation, the code proved the address, and this redeems the two together.
 */
type Step = "email" | "code" | "joining" | "orphan";

function AuthPage() {
  const { next, invite } = Route.useSearch();
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [joinError, setJoinError] = useState("");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  /**
   * Redeems the invitation if there is one, and routes onward.
   *
   * Called after the code is verified, and also on arrival — somebody who is
   * already signed in and follows an invitation link should not have to prove an
   * address they proved this morning.
   */
  /**
   * Whether the person who just accepted is an administrator of what they
   * joined. Read back from the database rather than assumed from the
   * invitation, because the role is the database's to state.
   */
  async function acceptedAsAdmin(organizationId: string): Promise<boolean> {
    const user = await getCurrentUser().catch(() => null);
    return Boolean(user && user.organizationId === organizationId && isAdmin(user));
  }

  /**
   * Where somebody with no workspace actually belongs.
   *
   * Neuvto staff have no profile — deliberately, since that absence is what
   * makes every tenant policy refuse them (D42). Without this they were told to
   * "ask your administrator to invite you", which for the person who invites
   * everybody is both wrong and a dead end. Sada hit it on the first attempt.
   */
  async function routeWorkspacelessUser() {
    if (await isPlatformAdmin().catch(() => false)) {
      window.location.href = "/admin";
      return true;
    }
    return false;
  }

  async function finish() {
    if (invite) {
      setStep("joining");
      try {
        const { organizationId } = await acceptInvitation(invite);
        // An administrator has a workspace to set up, and a dashboard cannot
        // tell them that — Sada landed on one and it could only report that he
        // had no leave balance. Everyone else goes where they were going.
        //
        // `next` still wins when it was given: somebody following a deep link
        // to a specific page asked for that page.
        if (!next && (await acceptedAsAdmin(organizationId))) {
          window.location.href = "/app/setup";
          return;
        }
        window.location.href = safeNext(next);
        return;
      } catch (e) {
        // Shown in place rather than as a toast that vanishes: this is the end
        // of the road for this link, and the message says what to do next.
        setJoinError(
          isAppError(e) ? e.message : "We couldn't complete your invitation. Please try again.",
        );
        return;
      }
    }
    window.location.href = safeNext(next);
  }

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (cancelled) return;
        // Already in a workspace. An invitation link is then either stale or
        // meant for somebody else; either way they belong where they were going.
        if (user) {
          window.location.href = safeNext(next);
          return;
        }
        setChecking(false);
      })
      .catch(async () => {
        // NO_ORGANIZATION lands here: authenticated, but in no workspace.
        if (cancelled) return;
        if (invite) {
          setChecking(false);
          void finish();
          return;
        }
        if (await routeWorkspacelessUser()) return;
        if (cancelled) return;
        setChecking(false);
        setStep("orphan");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, invite]);

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
      if (user) {
        window.location.href = safeNext(next);
        return;
      }
      // Signed in, but in no workspace yet — redeem the invitation, send staff
      // to the console, or explain.
      if (invite) await finish();
      else if (!(await routeWorkspacelessUser())) setStep("orphan");
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
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {invite ? "Accept your invitation" : "Sign in to Neuvto"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {invite
              ? "Confirm the address this invitation was sent to and we'll email you a 6-digit code."
              : "We'll email you a 6-digit code. No password needed."}
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

      {step === "joining" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {joinError ? "This invitation didn't work" : "Setting up your account…"}
          </h1>
          {joinError ? (
            <>
              <p role="alert" className="mt-2 text-sm text-destructive">
                {joinError}
              </p>
              <a
                href="/auth"
                className="mt-8 inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Adding you to your workspace. This only takes a moment.
            </p>
          )}
        </>
      )}

      {/*
        Signed in, and in no workspace. Previously a form that created one; now
        an explanation, because who administers a workspace is Neuvto's decision
        and not a side effect of who signed in first.
      */}
      {step === "orphan" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            You&apos;re not in a workspace yet
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Neuvto workspaces are set up for your company, and you join one by invitation. Ask your
            administrator to invite{" "}
            <span className="text-foreground">{email || "your address"}</span>, then follow the link
            in the email they send.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            If your company doesn&apos;t use Neuvto yet, get in touch at{" "}
            <a
              href="mailto:hello@neuvto.com"
              className="text-foreground underline underline-offset-4"
            >
              hello@neuvto.com
            </a>
            .
          </p>
        </>
      )}
    </main>
  );
}

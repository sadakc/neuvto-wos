import { createFileRoute } from "@tanstack/react-router";
import { CONSOLE_PATH } from "./neuvto-hq/index";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  accountStatus,
  requestOtp,
  verifyOtp,
  signOut,
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
 *
 * `signedIn` is an invitation link opened in a session that already belongs to
 * somebody — the one case where following `next` needs to be a choice rather
 * than something that happens to you.
 */
type Step = "email" | "code" | "joining" | "orphan" | "deactivated" | "signedIn";

function AuthPage() {
  const { next, invite } = Route.useSearch();
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [joinError, setJoinError] = useState("");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  /** The address the browser is *already* signed in as — not what was typed. */
  const [sessionEmail, setSessionEmail] = useState("");

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
      window.location.href = CONSOLE_PATH;
      return true;
    }
    return false;
  }

  /**
   * Stop, and say who this browser is signed in as.
   *
   * The invited address is deliberately not part of this — see the screen
   * itself for why.
   */
  function showSignedIn(address: string) {
    setSessionEmail(address);
    setStep("signedIn");
  }

  /**
   * Sign out, and come back to the same invitation.
   *
   * The link is rebuilt from the search params rather than reloaded, so the
   * only thing that survives the sign-out is the invitation itself. `next` is
   * carried when it was given: somebody who followed a deep link asked for
   * that page, and signing out to answer the invitation should not lose it.
   */
  async function onSignOutToInvite() {
    setBusy(true);
    try {
      await signOut();
      const params = new URLSearchParams({ invite: invite ?? "" });
      if (next) params.set("next", next);
      window.location.href = `/auth?${params.toString()}`;
    } catch (err) {
      fail(err);
      setBusy(false);
    }
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
        if (user) {
          // An invitation link arriving into a session that already has a
          // workspace. Where they end up is unchanged and still one click
          // away — but it stops being silent. Bouncing to a dashboard reads
          // as an invitation that does not work, and was reported as exactly
          // that; on a device a colleague is signed into, it also shows the
          // invitee somebody else's workspace.
          if (invite) {
            showSignedIn(user.email);
            setChecking(false);
            return;
          }
          // No invitation: they are in a workspace and asked for a page in it.
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
        setStep(await workspacelessStep());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, invite]);

  /**
   * Which "you are nowhere" screen this person should see.
   *
   * Deactivated and never-invited look identical from getCurrentUser — both
   * raise NO_ORGANIZATION, because current_org_id() is null either way. Only the
   * database can tell them apart, and only about the caller themselves.
   */
  async function workspacelessStep(): Promise<Step> {
    return (await accountStatus()) === "deactivated" ? "deactivated" : "orphan";
  }

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
        // The address just proved is already in a workspace, so there is
        // nothing for the invitation to do. Same rule as on arrival: say so
        // rather than answering an invitation with a dashboard.
        if (invite) {
          showSignedIn(user.email);
          return;
        }
        window.location.href = safeNext(next);
        return;
      }
      // Signed in, but in no workspace yet — redeem the invitation, send staff
      // to the console, or explain.
      if (invite) await finish();
      else if (!(await routeWorkspacelessUser())) setStep(await workspacelessStep());
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
        Signed in already, holding an invitation.

        The invited address is absent on purpose. The token is in the URL; the
        address it belongs to is not, and invitation_accept answers expired,
        revoked, already-accepted and addressed-to-someone-else with one
        message precisely so a token cannot be probed (D39). Printing the
        address here would rebuild that oracle in the browser, where anyone
        holding a link could read it.

        The sentence is conditional for the same reason: this screen cannot
        know whether the invitation is for somebody else or is this person's
        own, already accepted — so it offers both ways out instead of
        asserting which one they are.
      */}
      {step === "signedIn" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            You&apos;re already signed in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This browser is signed in as{" "}
            <span className="text-foreground">{sessionEmail || "another account"}</span>. An
            invitation is accepted by the address it was sent to.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            If this invitation is for a different address, sign out and we&apos;ll email a 6-digit
            code to it.
          </p>

          <div className="mt-8 flex flex-col gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={onSignOutToInvite}
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Signing out…" : "Sign out and use a different address"}
            </button>
            <a
              href={safeNext(next)}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Stay signed in and continue
            </a>
          </div>
        </>
      )}

      {/*
        Signed in, and their access was removed.

        Separated from "orphan" deliberately. Once access follows `is_active`,
        a deactivated person's current_org_id() is null, so getCurrentUser finds
        no profile and they landed on the screen below — which tells them they
        were never here and to seek an invitation. Both parts are untrue, and
        the advice would waste their time and their administrator's.
      */}
      {step === "deactivated" && (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Your access has been removed
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="text-foreground">{email || "This account"}</span> no longer has access
            to its workspace. Your leave history has not been deleted.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            If this is a mistake, your administrator can restore it — they do not need to invite you
            again.
          </p>
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

import { createFileRoute } from "@tanstack/react-router";
import { CONSOLE_PATH } from "@/platform/console-path";
import { NeuvtoLockup } from "@/components/shared/neuvto-mark";
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
  getSessionEmail,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { hardNavigate } from "@/platform/navigate";

export const Route = createFileRoute("/auth")({
  ssr: false,
  // The return type is annotated so `invite` is OPTIONAL in the route's search
  // type. Inferred, it would be required, and every other place that redirects
  // here — the OAuth consent screen, for one — would have to pass an empty
  // string it knows nothing about.
  validateSearch: (
    s: Record<string, unknown>,
  ): { next: string; invite?: string; reason?: "idle" | "absolute" } => ({
    next: typeof s.next === "string" ? s.next : "",
    invite: typeof s.invite === "string" && s.invite ? s.invite : undefined,
    // Why the last session ended. A URL parameter rather than transient state
    // because it has to survive the full page reload that sign-out performs.
    reason: s.reason === "idle" || s.reason === "absolute" ? s.reason : undefined,
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

/**
 * A `?next=` reduced to a same-origin path, or null if it is not one.
 *
 * ── this used to be three string checks, and they were not enough
 *
 * The previous version was:
 *
 *     if (!next.startsWith("/") || next.startsWith("//")) return "/app";
 *
 * carrying the comment "Only same-origin paths, so `?next=` cannot be used as an
 * open redirect." That was false, and the counter-example is one character:
 *
 *     /\evil.example.com/x
 *
 * It starts with `/`, does not start with `//`, so it was returned unchanged and
 * handed to `location.href`. Browsers fold a backslash into a forward slash
 * inside a special scheme, so it resolves to `https://evil.example.com/x`.
 *
 * That is an open redirect **on the sign-in page**, which is the worst place to
 * have one: the link a victim inspects genuinely reads `neuvto.com/auth?…`, and
 * where it lands is a page asking for the six-digit code we just emailed them.
 * Found by screen-prover on 4 Aug 2026 while testing something else.
 *
 * So: no hand-rolled string rules. Resolve against the real origin with the URL
 * parser — the same parser the browser will use — and compare origins. Anything
 * the parser reads as leaving this site is rejected, whatever spelling was used
 * to express it.
 */
function sameOriginPath(candidate: string): string | null {
  if (!candidate) return null;
  // `ssr: false` on this route, so window is present in practice. The fallback
  // keeps the function pure enough to unit test and refuses everything rather
  // than guessing an origin.
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  try {
    const url = new URL(candidate, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Where `?next=` points, or the app shell when it points nowhere safe. */
function safeNext(next: string) {
  return sameOriginPath(next) ?? "/app";
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

/**
 * Why the "you are already signed in" screen is showing.
 *
 * `invite` is the original case — an invitation link opened in somebody else's
 * session. `session` is the plain one: you clicked Sign in and you already are.
 * They differ only in words; the mechanism is identical.
 */
type SignedInVariant = "invite" | "session";

function AuthPage() {
  const { next, invite, reason } = Route.useSearch();
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [joinError, setJoinError] = useState("");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  /** The address the browser is *already* signed in as — not what was typed. */
  const [sessionEmail, setSessionEmail] = useState("");
  /** Which words the "already signed in" screen uses, and where its button goes. */
  const [signedInVariant, setSignedInVariant] = useState<SignedInVariant>("invite");
  const [signedInDestination, setSignedInDestination] = useState("/app");

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
   * Where somebody with no workspace actually belongs — as a destination, not
   * as a side effect.
   *
   * Neuvto staff have no profile — deliberately, since that absence is what
   * makes every tenant policy refuse them (D42). Without this they were told to
   * "ask your administrator to invite you", which for the person who invites
   * everybody is both wrong and a dead end. Sada hit it on the first attempt.
   *
   * It used to navigate and return a boolean, which is why it had no test: a
   * function that assigns `location.href` can only be observed by crashing
   * happy-dom. Returning a place instead makes the decision assertable, and the
   * decision is the part worth pinning.
   *
   * `next` is honoured here — it never used to be, so `/auth?next=/neuvto-hq`
   * from the console's own bounce was ignored — but NOT when it points into
   * `/app`. A staff member sent there loads a shell that immediately throws
   * NO_ORGANIZATION and bounces them back here, which is the loop this whole
   * change exists to end.
   */
  async function staffDestination(): Promise<string | null> {
    if (!(await isPlatformAdmin().catch(() => false))) return null;
    // Through the same parser as everything else. An earlier draft repeated the
    // three string checks inline here, which meant it also repeated the open
    // redirect they failed to prevent — two copies of a rule is one copy plus a
    // hole somebody has to find twice.
    const path = sameOriginPath(next);
    if (path && !path.startsWith("/app")) return path;
    return CONSOLE_PATH;
  }

  /**
   * Stop, and say who this browser is signed in as.
   *
   * The invited address is deliberately not part of this — see the screen
   * itself for why.
   *
   * `variant` decides the words, not the mechanism. "invite" is the original
   * case, unchanged; "session" is somebody who simply clicked Sign in while
   * already signed in. `destination` is where the primary button goes, computed
   * by the caller because only the caller knows whether this is a tenant
   * workspace or the platform console.
   */
  function showSignedIn(address: string, variant: SignedInVariant, destination: string) {
    setSessionEmail(address);
    setSignedInVariant(variant);
    setSignedInDestination(destination);
    setStep("signedIn");
  }

  /**
   * Sign out, and come back to the same place.
   *
   * The URL is rebuilt from the search params rather than reloaded, so the only
   * things that survive the sign-out are the invitation and the destination.
   * `next` is carried when it was given: somebody who followed a deep link asked
   * for that page, and signing out to answer the invitation should not lose it.
   *
   * `reason` is deliberately NOT carried. It describes why the last session
   * ended; re-showing "you were signed out after 30 minutes of inactivity" to
   * somebody who has just chosen to sign out is noise about an event they
   * already know about.
   */
  async function onSignOutAndReturn() {
    setBusy(true);
    try {
      await signOut();
      const params = new URLSearchParams();
      if (invite) params.set("invite", invite);
      if (next) params.set("next", next);
      const query = params.toString();
      hardNavigate(query ? `/auth?${query}` : "/auth");
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
          hardNavigate("/app/setup");
          return;
        }
        hardNavigate(safeNext(next));
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
    hardNavigate(safeNext(next));
  }

  /**
   * THE RULE, stated once: a `/auth` URL carrying no `next` and no `invite` is a
   * deliberate request for the sign-in screen, and is answered rather than
   * obeyed.
   *
   * Arriving with `next` or `invite` means something sent you here on the way to
   * somewhere — the console's own bounce, the OAuth consent screen, an emailed
   * link. That is intent, and it is followed.
   *
   * Clicking "Sign in" on the landing page carries neither. Bouncing that click
   * to wherever the existing session happens to belong is how a platform admin
   * ended up unable to reach anything but the console, and it is also how a
   * colleague's workspace appears to whoever clicks "Sign in" on a shared
   * laptop. Both are the same defect; this fixes both.
   *
   * (The path is deliberately not spelled here. CI fails any file but
   * console-path.ts that writes the literal, and it cannot tell prose from
   * code — which is the correct trade for a guardrail whose whole job is to
   * catch a forgotten href.)
   */
  const arrivedWithIntent = Boolean(invite) || Boolean(next);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          // An invitation link, or a plain "Sign in" click, arriving into a
          // session that already has a workspace. Where they end up is unchanged
          // and still one click away — but it stops being silent. Bouncing to a
          // dashboard reads as an invitation that does not work, and was
          // reported as exactly that; on a device a colleague is signed into, it
          // also shows the invitee somebody else's workspace.
          if (invite || !arrivedWithIntent) {
            showSignedIn(user.email, invite ? "invite" : "session", safeNext(next));
            setChecking(false);
            return;
          }
          // `next` was given: they asked for a page and are entitled to it.
          hardNavigate(safeNext(next));
          return;
        }
        setChecking(false);
      })
      .catch(async () => {
        // NO_ORGANIZATION lands here: authenticated, but in no workspace. This
        // is every Neuvto staff member, always, by design (D42).
        if (cancelled) return;
        if (invite) {
          setChecking(false);
          void finish();
          return;
        }
        const staff = await staffDestination();
        if (cancelled) return;
        if (staff) {
          // Intent → go. No intent → say who they are and offer the door,
          // rather than walking them through it.
          if (arrivedWithIntent) {
            hardNavigate(staff);
            return;
          }
          showSignedIn((await getSessionEmail().catch(() => null)) ?? "", "session", staff);
          setChecking(false);
          return;
        }
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
          showSignedIn(user.email, "invite", safeNext(next));
          return;
        }
        hardNavigate(safeNext(next));
        return;
      }
      // Signed in, but in no workspace yet — redeem the invitation, send staff
      // to the console, or explain.
      //
      // No interstitial here, deliberately: somebody who has just typed a
      // six-digit code has expressed intent as clearly as anybody ever does.
      // This is the branch D42 depends on — staff MUST still land on the
      // console after verifying, and deleting it is the likeliest way this
      // change breaks the thing it was built to protect.
      if (invite) {
        await finish();
      } else {
        const staff = await staffDestination();
        if (staff) hardNavigate(staff);
        else setStep(await workspacelessStep());
      }
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
      {/* Shown above every step. For an invited employee this is the first
          Neuvto screen they ever see, and an unbranded page asking for an
          email address after an emailed link is exactly what a phishing page
          looks like. */}
      <NeuvtoLockup className="mb-8" size="md" />

      {/* Why the last session ended. Shown above every step rather than only
          the email form, because an expiry can land somebody here holding an
          invitation or on their way to a deep link, and "you were signed out"
          is the first thing they need to know in all of those. */}
      {reason && (
        <p
          role="status"
          data-testid={`signed-out-${reason}`}
          className="mb-6 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
        >
          {reason === "idle"
            ? "You were signed out after a period of inactivity."
            : "You were signed out because your session reached its time limit."}{" "}
          Sign in again to carry on.
        </p>
      )}

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
            <span className="text-foreground">{sessionEmail || "another account"}</span>.
            {signedInVariant === "invite" &&
              " An invitation is accepted by the address it was sent to."}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {signedInVariant === "invite"
              ? "If this invitation is for a different address, sign out and we'll email a 6-digit code to it."
              : "Continue where you left off, or sign out to use a different address."}
          </p>

          {/* Order flips with the variant, and that is the whole point of having
              two. Holding an invitation, the likely intent is "this is not my
              address" — so signing out leads. Having simply clicked Sign in,
              the likely intent is to get on with it, so continuing leads and
              signing out is the secondary. */}
          <div
            className={`mt-8 flex gap-4 ${signedInVariant === "invite" ? "flex-col" : "flex-col-reverse"}`}
          >
            <button
              type="button"
              disabled={busy}
              onClick={onSignOutAndReturn}
              data-testid="signed-in-sign-out"
              className={
                signedInVariant === "invite"
                  ? "inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  : "inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-60"
              }
            >
              {busy ? "Signing out…" : "Sign out and use a different address"}
            </button>
            <a
              href={signedInDestination}
              data-testid="signed-in-continue"
              className={
                signedInVariant === "invite"
                  ? "inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
                  : "inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              }
            >
              {signedInVariant === "invite"
                ? "Stay signed in and continue"
                : signedInDestination === CONSOLE_PATH
                  ? "Continue to the console"
                  : "Continue to your workspace"}
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
          {/* Both of these screens were dead ends: somebody who lands here on
              the wrong account had no way to reach a different one, and the
              advice ("ask your administrator to invite you") is useless if the
              address being invited is not the address they are signed in as. */}
          <button
            type="button"
            disabled={busy}
            onClick={onSignOutAndReturn}
            data-testid="deactivated-sign-out"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-60"
          >
            {busy ? "Signing out…" : "Sign out and use a different address"}
          </button>
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
          {/* Both of these screens were dead ends: somebody who lands here on
              the wrong account had no way to reach a different one, and the
              advice ("ask your administrator to invite you") is useless if the
              address being invited is not the address they are signed in as. */}
          <button
            type="button"
            disabled={busy}
            onClick={onSignOutAndReturn}
            data-testid="orphan-sign-out"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-60"
          >
            {busy ? "Signing out…" : "Sign out and use a different address"}
          </button>
        </>
      )}
    </main>
  );
}

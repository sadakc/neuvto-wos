import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  getCurrentUser,
  isAdmin,
  listInvitations,
  listMembers,
  type CurrentUser,
} from "@/platform/auth";
import { supabase } from "@/integrations/supabase/client";
import { isAppError } from "@/platform/errors";
import { OrgModules } from "@/platform/modules";
import { WorkingCalendar } from "@/platform/calendar/WorkingCalendar";
import { CompanyIdentity } from "@/platform/organization/CompanyIdentity";
import {
  companyName,
  completeOnboarding,
  getOrganization,
  type Organization,
} from "@/platform/organization";
import { InviteTeam } from "@/platform/auth/InviteTeam";

export const Route = createFileRoute("/app/setup")({
  ssr: false,
  head: () => ({ meta: [{ title: "Set up your workspace — Neuvto" }] }),
  component: SetupWizard,
});

/**
 * Setting a workspace up, for the person who has just accepted an invitation to
 * administer it.
 *
 * They land here from the invitation, not on a dashboard — a dashboard is what
 * Sada got, and it could tell him nothing except that he had no leave balance.
 *
 * D46 — WHAT IS DONE IS DERIVED FROM THE DATA. There is no stored step number.
 * A counter and the data it describes drift apart, and when they do it is the
 * counter that lies: it says "step 4 of 6" about a workspace whose logo was
 * removed and whose modules were switched off an hour ago.
 * `onboarding_completed_at` records one thing only — that they chose to stop
 * being asked.
 *
 * Every step saves as it goes, and every step can be skipped. A wizard that
 * cannot be abandoned half-way is one people abandon at the beginning.
 */

interface SetupState {
  org: Organization | null;
  /** At least one module switched on. */
  hasModule: boolean;
  /** Anybody besides the administrator — a member or an outstanding invitation. */
  hasPeople: boolean;
}

type StepKey = "welcome" | "identity" | "calendar" | "modules" | "people" | "done";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "welcome", label: "Welcome" },
  { key: "identity", label: "Your company" },
  { key: "calendar", label: "Working calendar" },
  { key: "modules", label: "Modules" },
  { key: "people", label: "Your team" },
  { key: "done", label: "Done" },
];

/**
 * Whether a step has visibly been done.
 *
 * `welcome` and `done` are not configuration and are never "outstanding".
 *
 * `calendar` is deliberately always true, and that is the honest answer rather
 * than a shortcut: provisioning creates a valid settings row, so the calendar
 * IS configured — possibly not the way this customer wants, but there is no
 * observable difference between "reviewed and kept the defaults" and "never
 * looked". Claiming to know would be inventing a fact, and inventing it would
 * park somebody on a step forever for having agreed with it.
 */
function isDone(step: StepKey, s: SetupState): boolean {
  switch (step) {
    case "identity":
      return Boolean(s.org?.displayName || s.org?.logoPath || s.org?.industryType);
    case "modules":
      return s.hasModule;
    case "people":
      return s.hasPeople;
    default:
      return true;
  }
}

function SetupWizard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [data, setData] = useState<SetupState>({ org: null, hasModule: false, hasPeople: false });
  const [step, setStep] = useState<StepKey>("welcome");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [org, mods, members, invites] = await Promise.all([
      getOrganization(),
      supabase.from("organization_modules").select("enabled"),
      listMembers().catch(() => []),
      listInvitations("").catch(() => []),
    ]);
    const next: SetupState = {
      org,
      hasModule: (mods.data ?? []).some((m) => m.enabled),
      // A PENDING invitation, not any invitation. The administrator arrived
      // through one of their own, and counting it told them "Your team —
      // already set" about a workspace containing exactly themselves. Their own
      // invitation is accepted by the time they read this, so excluding
      // accepted ones is both correct and the simplest rule that is.
      hasPeople: members.length > 1 || invites.some((i) => !i.revokedAt && !i.acceptedAt),
    };
    setData(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await getCurrentUser().catch(() => null);
      if (cancelled) return;
      setUser(u);
      if (!isAdmin(u)) {
        setState("denied");
        return;
      }
      await refresh();
      if (!cancelled) setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Nothing to set up</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your administrator configures this workspace.
        </p>
        <Link
          to="/app"
          className="mt-6 inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
        >
          Go to your dashboard
        </Link>
      </div>
    );
  }

  const index = STEPS.findIndex((s) => s.key === step);
  const outstanding = STEPS.filter((s) => !isDone(s.key, data));
  const name = companyName(data.org) || user?.organizationName || "your workspace";

  async function go(to: StepKey) {
    setError("");
    await refresh();
    setStep(to);
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    setError("");
    try {
      if (data.org) await completeOnboarding(data.org.id);
      await navigate({ to: "/app" });
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't work. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl pb-16">
      {/* Progress, derived. Nothing here is read from a stored counter. */}
      <ol className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <button
              onClick={() => void go(s.key)}
              className={
                s.key === step
                  ? "font-medium text-foreground underline underline-offset-4"
                  : "hover:text-foreground"
              }
            >
              {s.label}
              {!isDone(s.key, data) && s.key !== step && <span aria-hidden> ·</span>}
            </button>
            {i < STEPS.length - 1 && <span aria-hidden>›</span>}
          </li>
        ))}
      </ol>

      {step === "welcome" && (
        <section className="mt-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome to {name}</h1>
          <p className="mt-3 max-w-prose text-sm text-muted-foreground">
            You&apos;re the administrator of this workspace. A few things to set up, and none of
            them take long — you can leave at any point and pick up where you stopped.
          </p>
          <ul className="mt-6 space-y-2 text-sm">
            {STEPS.filter((s) => s.key !== "welcome" && s.key !== "done").map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 rounded-full ${
                    isDone(s.key, data) ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                />
                <span>{s.label}</span>
                {isDone(s.key, data) && (
                  <span className="text-xs text-muted-foreground">already set</span>
                )}
              </li>
            ))}
          </ul>
          <button
            onClick={() => void go("identity")}
            data-testid="setup-start"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            {outstanding.length ? "Start" : "Review your setup"}
          </button>
        </section>
      )}

      {step === "identity" && (
        <StepShell
          title="Your company"
          blurb="What this workspace is called and the mark your people see on every screen — and in every email from it."
          onBack={() => void go("welcome")}
          onNext={() => void go("calendar")}
        >
          <CompanyIdentity onSaved={(org) => setData((d) => ({ ...d, org }))} />
        </StepShell>
      )}

      {step === "calendar" && (
        <StepShell
          title="Working calendar"
          blurb="Which days your company works, when the leave year starts, and how much notice a request needs. Everything counted in days is counted against this."
          onBack={() => void go("identity")}
          onNext={() => void go("modules")}
        >
          {data.org && <WorkingCalendar organizationId={data.org.id} />}
        </StepShell>
      )}

      {step === "modules" && (
        <StepShell
          title="Modules"
          blurb="What Neuvto has added to your workspace. Switch on what you want your people using."
          onBack={() => void go("calendar")}
          onNext={() => void go("people")}
        >
          <OrgModules user={user} />
        </StepShell>
      )}

      {step === "people" && (
        <StepShell
          title="Your team"
          blurb="Invite the people who will use this. They get an email with a link, confirm their address with a six-digit code, and land straight in your workspace."
          onBack={() => void go("modules")}
          onNext={() => void go("done")}
        >
          <InviteTeam onInvited={() => void refresh()} />
        </StepShell>
      )}

      {step === "done" && (
        <section className="mt-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {outstanding.length ? "Nearly there" : `${name} is ready`}
          </h1>

          {outstanding.length > 0 ? (
            <>
              <p className="mt-3 max-w-prose text-sm text-muted-foreground">
                You can finish now and come back to the rest whenever — nothing here is required,
                and your dashboard will remind you.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {outstanding.map((s) => (
                  <li key={s.key}>
                    <button
                      onClick={() => void go(s.key)}
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              Everything is configured. Your people can sign in and start using it, and you can
              change any of this later under Settings.
            </p>
          )}

          <p className="mt-4 max-w-prose text-sm text-muted-foreground">
            Modules you switched on may have their own setup — leave types, for instance. Your
            dashboard says so when something is missing.
          </p>

          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => void finish()}
              data-testid="setup-finish"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              Go to my dashboard
            </button>
            <button
              onClick={() => void go("welcome")}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Back to the start
            </button>
          </div>
        </section>
      )}

      {step !== "welcome" && step !== "done" && (
        <p className="mt-8 text-xs text-muted-foreground">
          Step {index} of {STEPS.length - 2} · everything saves as you go
        </p>
      )}
    </div>
  );
}

function StepShell({
  title,
  blurb,
  children,
  onBack,
  onNext,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="mt-8">
      <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">{blurb}</p>

      <div className="mt-6">{children}</div>

      <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row">
        <button
          onClick={onNext}
          data-testid="setup-next"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Continue
        </button>
        <button
          onClick={onBack}
          className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
        >
          Back
        </button>
      </div>
    </section>
  );
}

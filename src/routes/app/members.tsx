import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  deactivateMember,
  deactivationImpact,
  getCurrentUser,
  isAdmin,
  listInvitations,
  listMembers,
  revokeInvitation,
  setJoinedDate,
  setReportingLine,
  type AppRole,
  type CurrentUser,
  type DeactivationImpact,
  type Invitation,
  type Member,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import { InviteTeam } from "@/platform/auth/InviteTeam";

export const Route = createFileRoute("/app/members")({
  ssr: false,
  head: () => ({ meta: [{ title: "People — Neuvto WOS" }] }),
  component: MembersPage,
});

const ROLE_LABELS: Record<AppRole, string> = {
  org_admin: "Administrator",
  hr_admin: "HR administrator",
  manager: "Manager",
  employee: "Employee",
};

/**
 * The people in this workspace, and the ones who have been asked to join.
 *
 * Inviting is the only way in (D39). The form asks for email, role and phone —
 * phone because Sada wants one human rather than one email address, though it
 * is not verified and so is not an identity key yet (D41); the uniqueness it
 * buys is real but only within this organisation.
 *
 * What this screen deliberately never says: whether an address is already in
 * use in somebody else's workspace. That answer would make the box below a
 * staff-directory oracle (D40). Such an invitation is simply created and never
 * accepted; the person is told when they arrive, about their own address.
 */
function MembersPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  // The invite form owns its own state — see InviteTeam. What is left here is
  // what this page still does itself: revoking, copying a link, reporting lines
  // and deactivation.
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [leaving, setLeaving] = useState<Member | null>(null);
  const [impact, setImpact] = useState<DeactivationImpact | null>(null);
  const [successor, setSuccessor] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const baseUrl = typeof window === "undefined" ? "" : window.location.origin;

  async function load() {
    const [m, i] = await Promise.all([listMembers(), listInvitations(baseUrl)]);
    setMembers(m);
    setInvitations(i);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (cancelled) return;
        setUser(u);
        if (!isAdmin(u)) {
          setState("denied");
          return;
        }
        await load();
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRevoke(id: string) {
    setError("");
    try {
      await revokeInvitation(id);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That invitation couldn't be withdrawn.");
    }
  }

  async function onSetManager(employeeId: string, managerId: string | null) {
    setError("");
    setNotice("");
    try {
      await setReportingLine(employeeId, managerId);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That reporting line couldn't be set.");
      // Reload regardless: the select is showing a value the database refused,
      // and leaving it there tells the person their change stuck.
      await load();
    }
  }

  async function onSetJoinedDate(employeeId: string, joinedDate: string) {
    setError("");
    setNotice("");
    try {
      await setJoinedDate(employeeId, joinedDate);
      setNotice("Start date updated. Entitlement for this year is calculated from it.");
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That start date couldn't be saved.");
      await load();
    }
  }

  async function onAskDeactivate(m: Member) {
    setError("");
    setNotice("");
    setLeaving(m);
    setSuccessor("");
    setImpact(null);
    try {
      setImpact(await deactivationImpact(m.id));
    } catch {
      // The confirmation still works without the counts — it just cannot be
      // specific. Better than refusing to open.
      setImpact({ reports: 0, approvals: 0 });
    }
  }

  async function onDeactivate(employeeId: string) {
    setError("");
    setBusy(true);
    try {
      const moved = await deactivateMember(employeeId, successor);
      setLeaving(null);
      setNotice(
        moved.reports === 0 && moved.approvals === 0
          ? "Deactivated. They held no reports or approvals."
          : `Deactivated. ${moved.reports} report${moved.reports === 1 ? "" : "s"} and ` +
              `${moved.approvals} approval${moved.approvals === 1 ? "" : "s"} moved over.`,
      );
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That person couldn't be deactivated.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your administrator manages who is in this workspace.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load the people in this workspace. Try refreshing.
        </p>
      </div>
    );
  }

  const pending = invitations.filter((i) => !i.acceptedAt && !i.revokedAt);
  const active = members.filter((m) => m.isActive);
  const inactive = members.filter((m) => !m.isActive);

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="font-display text-xl font-semibold tracking-tight">People</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Everyone in {user?.organizationName ?? "this workspace"}, and anyone waiting to join.
      </p>

      {/* ─────────────────────────────────────────────── invite */}
      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="font-display text-base font-semibold">Invite somebody</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          They&apos;ll get an email with a link. Following it, they confirm their address with a
          six-digit code and land straight in this workspace.
        </p>

        <div className="mt-4">
          <InviteTeam onInvited={() => void load()} />
        </div>
      </section>

      {error && (
        <p role="alert" data-testid="members-error" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          data-testid="members-notice"
          className="mt-4 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}

      {/* ─────────────────────────────────────────────── pending */}
      {pending.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-base font-semibold">Waiting to join</h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {pending.map((i) => (
              <li
                key={i.id}
                data-testid="pending-invitation"
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.fullName || i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.fullName ? `${i.email} · ` : ""}
                    {ROLE_LABELS[i.role]} · expires{" "}
                    {new Date(i.expiresAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {/* For when the email is slow, or lands in a spam folder. The
                      administrator created this invitation and can revoke it, so
                      showing them the link grants nothing they did not have. */}
                  {i.inviteUrl && (
                    <button
                      onClick={() => {
                        void navigator.clipboard?.writeText(i.inviteUrl!);
                        setCopied(i.id);
                      }}
                      className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                    >
                      {copied === i.id ? "Copied" : "Copy link"}
                    </button>
                  )}
                  <button
                    onClick={() => onRevoke(i.id)}
                    data-testid="revoke-invitation"
                    className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                  >
                    Withdraw
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─────────────────────────────────────────────── members */}
      <section className="mt-10">
        <h2 className="font-display text-base font-semibold">In this workspace</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Who reports to whom decides who approves what — the approval chain resolves the reporting
          manager, so a person with nobody above them has nowhere to send a request.
        </p>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {active.map((m) => (
            <li key={m.id} data-testid="member-row" className="p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {m.fullName || m.email}
                    {m.id === user?.id && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.email}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {m.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Employee"}
                </span>
              </div>

              {/* The start date drives pro-rated entitlement (D3), so changing
                  it changes how much leave this person gets for the year. Kept
                  editable — a typo at onboarding is common — and every change is
                  recorded with the row before and after. */}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor={`joined-${m.id}`} className="text-xs text-muted-foreground sm:w-28">
                  Started
                </label>
                <input
                  id={`joined-${m.id}`}
                  type="date"
                  data-testid="joined-date"
                  defaultValue={m.joinedDate}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== m.joinedDate) {
                      void onSetJoinedDate(m.id, e.target.value);
                    }
                  }}
                  className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>

              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor={`mgr-${m.id}`} className="text-xs text-muted-foreground sm:w-28">
                  Reports to
                </label>
                <select
                  id={`mgr-${m.id}`}
                  data-testid="reporting-line"
                  value={m.managerId ?? ""}
                  onChange={(e) => onSetManager(m.id, e.target.value || null)}
                  className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">Nobody</option>
                  {active
                    .filter((c) => c.id !== m.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName || c.email}
                      </option>
                    ))}
                </select>

                {m.id !== user?.id && (
                  <button
                    onClick={() => onAskDeactivate(m)}
                    data-testid="deactivate"
                    className="inline-flex h-12 shrink-0 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                  >
                    Deactivate
                  </button>
                )}
              </div>

              {/* The confirmation, inline rather than a modal: it has to name what
                  moves, and a person deciding that wants the list in front of
                  them, not behind a dialog. */}
              {leaving?.id === m.id && (
                <div
                  data-testid="deactivate-confirm"
                  className="mt-3 rounded-md border border-border bg-secondary/30 p-4"
                >
                  <p className="text-sm font-medium">Deactivate {m.fullName || m.email}?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {impact === null
                      ? "Checking what they hold…"
                      : impact.reports === 0 && impact.approvals === 0
                        ? "They hold no reports and no waiting approvals."
                        : `${impact.reports} direct report${impact.reports === 1 ? "" : "s"} and ` +
                          `${impact.approvals} waiting approval${impact.approvals === 1 ? "" : "s"} ` +
                          `will move to whoever you choose.`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Their own leave that is still awaiting approval is cancelled and the days go
                    back. Leave already approved is left alone.
                  </p>

                  <label htmlFor={`succ-${m.id}`} className="mt-3 block text-sm font-medium">
                    Hand their work to
                  </label>
                  <select
                    id={`succ-${m.id}`}
                    data-testid="successor"
                    value={successor}
                    onChange={(e) => setSuccessor(e.target.value)}
                    className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="">Choose somebody…</option>
                    {active
                      .filter((c) => c.id !== m.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.fullName || c.email}
                        </option>
                      ))}
                  </select>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onDeactivate(m.id)}
                      disabled={!successor || busy}
                      data-testid="confirm-deactivate"
                      className="inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? "Deactivating…" : "Deactivate and hand over"}
                    </button>
                    <button
                      onClick={() => setLeaving(null)}
                      className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ─────────────────────────────────────────────── inactive
          Listed rather than hidden. Somebody who has left is still on last
          year's leave records, and a workspace that simply loses them looks
          like data going missing. */}
      {inactive.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-base font-semibold">No longer active</h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-dashed border-border">
            {inactive.map((m) => (
              <li key={m.id} data-testid="inactive-row" className="p-4">
                <span className="block truncate text-sm text-muted-foreground">
                  {m.fullName || m.email}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Their history stays. Bringing somebody back is not built yet — ask for it if you need
            it.
          </p>
        </section>
      )}
    </div>
  );
}

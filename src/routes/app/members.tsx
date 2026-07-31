import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getCurrentUser,
  isAdmin,
  listInvitations,
  listMembers,
  revokeInvitation,
  type AppRole,
  type CurrentUser,
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
  // what this page still does itself: revoking, and copying a link.
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

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
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {members.map((m) => (
            <li
              key={m.id}
              data-testid="member-row"
              className="flex items-baseline justify-between gap-4 p-4"
            >
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
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Setting who reports to whom, and removing people, arrive with the manager screens.
        </p>
      </section>
    </div>
  );
}

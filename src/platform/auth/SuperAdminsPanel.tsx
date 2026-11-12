import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  addSuperAdmin,
  listSuperAdmins,
  removeSuperAdmin,
  withdrawSuperAdminInvite,
  type CompanySuperAdmin,
} from "./platform";

/**
 * One company's Super Admins, inside the console row it belongs to (D83).
 *
 * Neuvto can add one (a member is promoted, anybody else is invited) and remove
 * one. It cannot remove the last: the database refuses, and the message says
 * what to do instead. Removing asks once more, inline, because it takes away
 * the right to manage the company's access from a real person.
 */
export function SuperAdminsPanel({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [rows, setRows] = useState<CompanySuperAdmin[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function reload() {
    setRows(await listSuperAdmins(organizationId));
  }

  useEffect(() => {
    let cancelled = false;
    listSuperAdmins(organizationId)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRows([]);
          setError(isAppError(e) ? e.message : "We couldn't load this company's Super Admins.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function run(key: string, work: () => Promise<string | void>) {
    setError("");
    setNotice("");
    setBusy(key);
    try {
      const said = await work();
      if (said) setNotice(said);
      await reload();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That couldn't be changed.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    void run("add", async () => {
      const result = await addSuperAdmin(organizationId, email, name);
      setEmail("");
      setName("");
      return result === "promoted"
        ? "They're a Super Admin now."
        : result === "already"
          ? "They're already a Super Admin, or already invited as one."
          : "Invited. They become a Super Admin when they accept.";
    });
  }

  const members = rows?.filter((r) => r.kind === "member") ?? [];
  const onlyOne = members.length === 1;

  return (
    <div
      data-testid="super-admins-panel"
      className="mt-3 rounded-md border border-border bg-secondary/30 p-3"
    >
      <p className="text-sm font-medium">Super Admins</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        They manage who can do what at {organizationName}. A company always keeps at least one.
      </p>

      {rows === null ? (
        <div className="mt-3 h-8 animate-pulse rounded bg-muted" />
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.length === 0 && <li className="text-sm text-muted-foreground">Nobody yet.</li>}
          {rows.map((r) => {
            const key = r.userId ?? r.invitationId ?? "";
            return (
              <li
                key={key}
                data-testid="super-admin-row"
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.fullName || r.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.fullName ? `${r.email} · ` : ""}
                    {r.kind === "invited"
                      ? "Invited, not accepted yet"
                      : r.isActive
                        ? "Super Admin"
                        : "Super Admin · deactivated"}
                  </span>
                </span>

                <span className="flex shrink-0 flex-wrap gap-2">
                  {r.kind === "invited" && r.inviteUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(r.inviteUrl!);
                        setCopied(key);
                      }}
                      className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                    >
                      {copied === key ? "Copied" : "Copy link"}
                    </button>
                  )}

                  {confirming === key ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === key}
                        data-testid="super-admin-confirm-remove"
                        onClick={() =>
                          void run(key, () =>
                            r.kind === "invited"
                              ? withdrawSuperAdminInvite(r.invitationId!)
                              : removeSuperAdmin(organizationId, r.userId!),
                          )
                        }
                        className="inline-flex h-12 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                      >
                        {busy === key
                          ? "Saving…"
                          : r.kind === "invited"
                            ? "Withdraw invitation"
                            : "Remove Super Admin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid="super-admin-remove"
                      // The database refuses the last one anyway; saying so
                      // here saves a round trip to learn it.
                      disabled={r.kind === "member" && onlyOne}
                      title={
                        r.kind === "member" && onlyOne
                          ? "The only Super Admin. Add another first."
                          : undefined
                      }
                      onClick={() => {
                        setError("");
                        setNotice("");
                        setConfirming(key);
                      }}
                      className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm disabled:opacity-40"
                    >
                      {r.kind === "invited" ? "Withdraw" : "Remove"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={onAdd} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={`sa-email-${organizationId}`} className="block text-xs font-medium">
            Email
          </label>
          <input
            id={`sa-email-${organizationId}`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="someone@company.com"
            data-testid="super-admin-email"
            className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="flex-1">
          <label htmlFor={`sa-name-${organizationId}`} className="block text-xs font-medium">
            Name, if they're new
          </label>
          <input
            id={`sa-name-${organizationId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
            className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy === "add"}
          data-testid="super-admin-add"
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === "add" ? "Adding…" : "Add Super Admin"}
        </button>
      </form>

      {notice && (
        <p role="status" data-testid="super-admin-notice" className="mt-2 text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="super-admin-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

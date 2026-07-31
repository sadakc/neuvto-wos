/**
 * Inviting people, on its own.
 *
 * Extracted from the Members screen so the setup wizard and Settings share one
 * form. The rules an invitation can break are already stated in three places —
 * a CHECK constraint, a SECURITY DEFINER function, and the error map in
 * `members.ts` — and a fourth copy of the form would be a fourth place for the
 * wording to drift.
 *
 * D40 is the thing this form deliberately does NOT say. An address already in
 * use in another customer's workspace produces no error here; the invitation is
 * created and simply never accepted, and the person is told about their own
 * address when they arrive. Reporting it here would turn this into a way to
 * enumerate a competitor's staff by typing addresses and watching which bounce.
 */

import { useState } from "react";
import { isAppError } from "@/platform/errors";
import { APP_ROLES, type AppRole } from "./contracts";
import { inviteMember } from "./members";

const ROLE_LABELS: Record<AppRole, string> = {
  org_admin: "Administrator",
  hr_admin: "HR administrator",
  manager: "Manager",
  employee: "Employee",
};

export function InviteTeam({ onInvited }: { onInvited?: () => void }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AppRole>("employee");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await inviteMember({ email, phone, role, fullName });
      setSent((s) => [email, ...s]);
      setEmail("");
      setPhone("");
      setFullName("");
      onInvited?.();
    } catch (err) {
      setError(
        isAppError(err)
          ? err.message
          : err instanceof Error && "issues" in err
            ? (err as { issues: { message: string }[] }).issues[0].message
            : "That invitation couldn't be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inv-email" className="block text-sm font-medium">
            Work email
          </label>
          <input
            id="inv-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="inv-phone" className="block text-sm font-medium">
            Phone
          </label>
          <input
            id="inv-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Tells one person from another when they have several addresses
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inv-name" className="block text-sm font-medium">
            Name <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="inv-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="inv-role" className="block text-sm font-medium">
            Role
          </label>
          <select
            id="inv-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {APP_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" data-testid="invite-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !email}
        data-testid="send-invite"
        className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send invitation"}
      </button>

      {sent.length > 0 && (
        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <p className="text-sm font-medium">Invited</p>
          <ul className="mt-1 space-y-0.5">
            {sent.map((e) => (
              <li key={e} className="text-sm text-muted-foreground">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

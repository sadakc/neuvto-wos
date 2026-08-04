/**
 * Whether mail is getting out, said on the one screen Neuvto staff open.
 *
 * On 3 Aug 2026 three invitations failed on production across twelve hours and
 * nothing anywhere said so. The cron ran every minute, the dispatcher returned
 * 200, and Resend refused every message. It was found by querying
 * `net._http_response` by hand. For a customer the symptom would have been a
 * person saying "I never got it", days later.
 *
 * ── why a banner and not an email
 *
 * The obvious alarm is to email somebody. It cannot be: the thing being watched
 * is the ability to send email, so the alarm would travel the exact path it
 * reports broken — and fail silently in the same way, which also removes the
 * worry. So it is shown here instead.
 *
 * That is passive: it alarms when somebody looks. That is the honest limit of
 * what can be built without a second channel, and it is stated rather than
 * dressed up. When a webhook exists (Slack or Discord, both free), it posts
 * these same numbers and this component does not change.
 *
 * ── silence is never success
 *
 * When healthy, this renders a quiet line rather than nothing. A banner that
 * appears only on failure is indistinguishable from a banner that is broken,
 * and the whole point of this component is to be trusted when it says nothing
 * is wrong.
 */

import type { MailHealth } from "./platform";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function MailHealthBanner({ health }: { health: MailHealth | null }) {
  // The check itself could not be read. Deliberately not silent and deliberately
  // not alarming: "unknown" is its own state, and claiming either health or
  // failure here would be inventing a fact.
  if (health === null) {
    return (
      <p data-testid="mail-health-unknown" className="mt-6 text-sm text-muted-foreground">
        Mail delivery could not be checked.
      </p>
    );
  }

  if (health.healthy) {
    return (
      <p data-testid="mail-health-ok" className="mt-6 text-sm text-muted-foreground">
        Mail is being delivered — last sent {ago(health.lastSentAt)}.
      </p>
    );
  }

  return (
    <div
      role="alert"
      data-testid="mail-health-alert"
      className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
    >
      <h2 className="font-display text-base font-semibold text-destructive">
        Mail is not being delivered
      </h2>

      <p className="mt-2 text-sm">
        {health.failed24h > 0 && (
          <>
            <strong className="tabular-nums">{health.failed24h}</strong>{" "}
            {health.failed24h === 1 ? "message has" : "messages have"} failed in the last 24
            hours.{" "}
          </>
        )}
        {health.pendingNow > 0 && (
          <>
            <strong className="tabular-nums">{health.pendingNow}</strong> waiting, the oldest for{" "}
            <strong className="tabular-nums">{health.oldestPendingMinutes}</strong> minutes.
          </>
        )}
      </p>

      {health.lastFailureReason && (
        // The provider's own words. This is what turns the alarm into a fix —
        // "API key is invalid" is the entire answer — so it is shown verbatim
        // rather than translated into something friendlier and useless.
        <pre
          data-testid="mail-health-reason"
          className="mt-3 overflow-x-auto rounded border border-border bg-background p-3 text-xs"
        >
          {health.lastFailureReason}
        </pre>
      )}

      <p className="mt-3 text-sm text-muted-foreground">
        Invitations and approval emails are affected. Nothing is lost — messages stay queued and
        send once this is fixed. Last successful send: {ago(health.lastSentAt)}.
      </p>
    </div>
  );
}

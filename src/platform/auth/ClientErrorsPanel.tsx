/**
 * What broke in the browser, on the one screen Neuvto staff open.
 *
 * The counterpart to MailHealthBanner, and it exists for the same reason: until
 * 4 Aug 2026 a crash in production went nowhere. The root error boundary caught
 * it, rendered "This page didn't load", and reported it to `window.__lovableEvents`
 * — which is undefined outside the Lovable editor. Verified against the live
 * site rather than assumed.
 *
 * Same honest limit as the mail banner, too: this is **passive**. It alarms when
 * somebody looks. That is what can be built without a second channel, and when a
 * webhook exists (Slack or Discord, both free) it posts these same numbers and
 * this component does not change.
 *
 * ── silence is never success
 *
 * When there is nothing to report this renders a quiet line, not nothing. A
 * panel that appears only on failure is indistinguishable from a panel that is
 * broken, and the whole point is to be believed when it says all is well.
 *
 * ── what is deliberately not here
 *
 * No organisation column. Which customer hit a bug is tenant data (D42), and a
 * fault is diagnosable without knowing whose employee met it. The database does
 * not return it either, so this is not a display choice that a later edit can
 * quietly undo.
 */

import { useState } from "react";
import type { ClientErrorGroup } from "./platform";
import { StatusBadge } from "@/components/shared/status-badge";

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * A fault seen on several days is a different thing from a burst.
 *
 * Two hundred occurrences in one afternoon is one bad deploy. Two hundred across
 * six days is something structural that nobody has noticed. The count alone
 * cannot tell them apart, so the tone does.
 */
function tone(group: ClientErrorGroup): "destructive" | "warning" | "neutral" {
  // Severity is a ceiling, not the signal. Everything reported today arrives as
  // "error" — the client sends nothing else — so ranking by it would put every
  // fault in one bucket and tell you nothing about which to open first. Counts
  // do that job. But when a capture site eventually reports something as info,
  // it must not be able to shout: a self-reported severity may lower the tone
  // and may never raise it.
  if (group.severity === "info") return "neutral";
  if (group.daysSeen >= 3) return group.severity === "warning" ? "warning" : "destructive";
  if (group.occurrences >= 10) return "warning";
  return "neutral";
}

export function ClientErrorsPanel({ groups }: { groups: ClientErrorGroup[] | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // The store itself could not be read. Not silent and not alarming: "unknown"
  // is its own state, and claiming either health or failure would invent a fact.
  if (groups === null) {
    return (
      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-foreground">Front-end errors</h2>
        <p data-testid="client-errors-unknown" className="mt-2 text-sm text-muted-foreground">
          The error store could not be read.
        </p>
      </section>
    );
  }

  if (groups.length === 0) {
    return (
      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-foreground">Front-end errors</h2>
        <p data-testid="client-errors-none" className="mt-2 text-sm text-muted-foreground">
          No front-end errors in the last 7 days.{" "}
          <span className="text-muted-foreground/70">
            Signed-in pages only — the landing page and sign-in are not covered.
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-foreground">Front-end errors</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Last 7 days, grouped. Signed-in pages only — the landing page and sign-in are not covered.
      </p>

      <ul data-testid="client-errors-list" className="mt-4 space-y-2">
        {groups.map((g) => {
          const open = expanded === g.fingerprint;
          return (
            <li key={g.fingerprint} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-foreground">{g.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{g.route ?? "unknown route"}</span>
                    {" · "}
                    {g.mechanism}
                    {" · last "}
                    {ago(g.lastSeenAt)}
                    {g.daysSeen > 1 && ` · on ${g.daysSeen} days`}
                    {g.release && ` · ${g.release.slice(0, 7)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* The count is the label, so colour is never the only signal. */}
                  <StatusBadge tone={tone(g)}>{g.occurrences}×</StatusBadge>
                  {g.stack && (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : g.fingerprint)}
                      aria-expanded={open}
                      aria-controls={`client-error-stack-${g.fingerprint}`}
                      className="inline-flex h-12 items-center rounded-md border border-input px-3 text-xs font-medium text-foreground hover:bg-accent"
                    >
                      {open ? "Hide trace" : "Show trace"}
                    </button>
                  )}
                </div>
              </div>

              {open && g.stack && (
                <pre
                  id={`client-error-stack-${g.fingerprint}`}
                  data-testid={`client-error-stack-${g.fingerprint}`}
                  className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground"
                >
                  {g.stack}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

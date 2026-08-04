/**
 * A status, drawn the same way everywhere.
 *
 * Leave management is a status-driven product and, until now, a status was
 * rendered as `text-xs text-muted-foreground` — the same grey whether a request
 * was approved, declined or still waiting. Every state looked identical at a
 * glance, so "what happened to my leave?" could only be answered by reading.
 *
 * ── two rules this component exists to enforce
 *
 * **Colour is never the only signal.** Each badge carries its label, always.
 * Around one in twelve men has some form of colour vision deficiency, and
 * red/green is the common axis — which is exactly the approved/declined axis.
 * A colour-only badge is unreadable to them and to anyone printing in
 * greyscale. The label is not a caption on the colour; the colour is emphasis
 * on the label.
 *
 * **The mapping is fixed** (DESIGN_SYSTEM §3) and lives here rather than in
 * each screen. Pending amber on one screen and pending grey on another is how
 * a person learns to distrust the colour entirely.
 *
 * ── on `tone` rather than `status`
 *
 * This is a platform component and must not know what a leave request is —
 * a module's vocabulary in `components/shared` is how the next module ends up
 * importing Leave. It takes a tone; the Leave module maps its own statuses to
 * tones through `LEAVE_STATUS_TONE`, which lives with Leave.
 */

import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "info" | "neutral";

/**
 * `subtle` is the default: a tinted fill with body-coloured text. Solid fills
 * are loud, and a table of thirty leave requests rendered in solid amber and
 * green is a fruit salad nobody can scan.
 *
 * `solid` is for the one status on a page that is the point of the page — the
 * decision on a request you just opened.
 */
type Emphasis = "subtle" | "solid";

const SUBTLE: Record<StatusTone, string> = {
  success: "bg-success-muted text-foreground",
  warning: "bg-warning-muted text-foreground",
  destructive: "bg-destructive-muted text-foreground",
  info: "bg-info-muted text-foreground",
  neutral: "bg-neutral-muted text-foreground",
};

const SOLID: Record<StatusTone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  info: "bg-info text-info-foreground",
  neutral: "bg-neutral text-neutral-foreground",
};

export function StatusBadge({
  tone,
  children,
  emphasis = "subtle",
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  emphasis?: Emphasis;
  className?: string;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        emphasis === "solid" ? SOLID[tone] : SUBTLE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

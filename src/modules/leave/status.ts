/**
 * Leave's own statuses, and how each one is drawn and named.
 *
 * Lives with Leave rather than in `components/shared` because "pending_approval"
 * is Leave's vocabulary. The shared `StatusBadge` knows only about tones; this
 * is the translation, and the next module writes its own.
 *
 * The tone mapping is fixed by DESIGN_SYSTEM §3 and must not be improvised per
 * screen — a status that is amber on one page and grey on another teaches
 * people to ignore the colour.
 */

import type { StatusTone } from "@/components/shared/status-badge";
import type { LeaveStatus } from "./contracts";

/**
 * What a person calls each status.
 *
 * "Declined", not "Rejected". The database column says `rejected` and will keep
 * saying it; a person reading that their leave was *rejected* hears something
 * harsher than a manager who picked "no, not that week" meant, and there is no
 * reason to make a routine scheduling answer feel personal.
 */
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};

export const LEAVE_STATUS_TONE: Record<LeaveStatus, StatusTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "neutral",
};

/**
 * The calendar disagrees with the list on purpose.
 *
 * An approved request shows a GREEN badge in a list and a BLUE cell in a
 * calendar (`06` §Leave Calendar). Green on a calendar grid reads as "this day
 * is free" — the exact opposite of what an approved absence means — while blue
 * reads as "booked". Keep it, and keep it here where it is visible, rather than
 * as an inconsistency someone later tidies up.
 */
export const LEAVE_CALENDAR_TONE: Record<LeaveStatus, StatusTone> = {
  ...LEAVE_STATUS_TONE,
  approved: "info",
};

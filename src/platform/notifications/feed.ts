/**
 * Platform · Notifications · the bell (D111)
 *
 * The person's own notices, newest first: whatever the Notification Engine
 * has told them, emailed or not, and the notices that are for the bell alone.
 * Where each opens is answered by the module the notice is about
 * (`notificationLinks` in its manifest); this file names no module.
 */

import { supabase } from "@/integrations/supabase/client";
import { toAppError } from "@/platform/errors";

export interface Notice {
  id: string;
  eventKey: string;
  subject: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export async function listNotices(limit = 30): Promise<Notice[]> {
  const { data, error } = await supabase.rpc("notifications_feed", { _limit: limit });
  if (error) throw toAppError(error, "listNotices");
  return (data ?? []).map((n) => ({
    id: n.id,
    eventKey: n.event_key,
    subject: n.subject,
    payload: (n.payload ?? {}) as Record<string, unknown>,
    createdAt: n.created_at,
    readAt: n.read_at,
  }));
}

export async function countUnread(): Promise<number> {
  const { data, error } = await supabase.rpc("notifications_unread");
  if (error) throw toAppError(error, "countUnread");
  return data ?? 0;
}

/** Marks these as opened; none named is every one. */
export async function markRead(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc("notifications_mark_read", { _ids: ids ?? undefined });
  if (error) throw toAppError(error, "markRead");
}

type Linker = (payload: Record<string, unknown>) => string | null;

export interface LinkContext {
  /** A module's own events, by key. */
  links: Map<string, Linker>;
  /** Which module raises each approval entity type. */
  moduleOfEntity: Map<string, string>;
  /** Each module's links, for the approval events of its own entities. */
  linksByModule: Map<string, Record<string, Linker>>;
}

/** Approval events that mean "this is waiting on you". */
const WAITING = new Set([
  "approval.submitted",
  "approval.escalated",
  "approval.delegated",
  "approval.escalation_stuck",
]);

/**
 * Where a notice opens. A module's own event goes where the module says. An
 * approval goes to the module's approvals if it is waiting on you, or where
 * the module says for its decisions (your own leave, say). A copy for your
 * information goes where the event itself would. Anything else, Home.
 */
export function noticeLink(n: Pick<Notice, "eventKey" | "payload">, ctx: LinkContext): string {
  const own = ctx.links.get(n.eventKey);
  if (own) return own(n.payload) ?? "/app";
  if (n.eventKey.startsWith("approval.")) {
    const event = n.eventKey.replace(/_fyi$/, "");
    const fyi = event !== n.eventKey;
    const entity = typeof n.payload.entity_type === "string" ? n.payload.entity_type : "";
    const mod = ctx.moduleOfEntity.get(entity);
    const answer = mod ? ctx.linksByModule.get(mod)?.[event] : undefined;
    if (answer) return answer(n.payload) ?? "/app";
    if (WAITING.has(event) && !fyi) return mod ? `/app/approvals?m=${mod}` : "/app/approvals";
  }
  return "/app";
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
export function whenText(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24 && then.getDate() === now.getDate()) return `${hours} h ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return "yesterday";
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

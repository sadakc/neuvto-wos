/**
 * The bell, top right (D111): how many notices you have not opened, and the
 * notices themselves in a list, newest first, the way Teams shows them.
 * Pressing one marks it read and opens the screen it is about.
 *
 * The count is asked for on load, every minute after, and whenever the tab is
 * looked at again; the list is read each time it is opened.
 */

import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNotificationLinks } from "@/platform/modules";
import { cn } from "@/lib/utils";
import {
  countUnread,
  listNotices,
  markRead,
  noticeLink,
  whenText,
  type LinkContext,
  type Notice,
} from "./feed";

const EVERY_MINUTE = 60_000;

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [links, setLinks] = useState<LinkContext | null>(null);

  const refreshCount = useCallback(() => {
    countUnread()
      .then(setUnread)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, EVERY_MINUTE);
    const onFocus = () => document.visibilityState === "visible" && refreshCount();
    document.addEventListener("visibilitychange", onFocus);
    getNotificationLinks()
      .then(setLinks)
      .catch(() => {});
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    listNotices()
      .then(setNotices)
      .catch(() => setNotices([]));
  }, [open]);

  async function onOpenNotice(n: Notice) {
    setOpen(false);
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      setNotices((list) =>
        (list ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      await markRead([n.id]).catch(() => {});
    }
    const href = links
      ? noticeLink(n, links)
      : noticeLink(n, { links: new Map(), moduleOfEntity: new Map(), linksByModule: new Map() });
    void navigate({ href });
  }

  async function onMarkAll() {
    await markRead().catch(() => {});
    setUnread(0);
    const now = new Date().toISOString();
    setNotices((list) => (list ?? []).map((x) => ({ ...x, readAt: x.readAt ?? now })));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          data-testid="bell"
          className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 && (
            <span
              data-testid="bell-count"
              aria-hidden
              className="absolute top-1 right-1 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[0.6875rem] leading-[1.125rem] font-semibold text-destructive-foreground"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-card-title font-semibold tracking-card-title">Notifications</h2>
          {notices?.some((n) => !n.readAt) && (
            <button
              type="button"
              onClick={() => void onMarkAll()}
              className="text-sm font-medium text-primary hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>
        {notices === null ? (
          <div className="m-4 h-24 animate-pulse rounded-lg bg-muted" />
        ) : notices.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. What needs you will show up here.
          </p>
        ) : (
          <ul className="max-h-[min(28rem,70vh)] divide-y divide-border overflow-y-auto">
            {notices.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  data-testid="notice"
                  data-unread={n.readAt ? "false" : "true"}
                  onClick={() => void onOpenNotice(n)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted",
                    !n.readAt && "bg-accent/40",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.readAt ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      data-testid="notice-subject"
                      className={cn("block text-sm leading-snug", !n.readAt && "font-semibold")}
                    >
                      {n.subject}
                    </span>
                    <span className="mt-0.5 block text-caption text-muted-foreground">
                      {whenText(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && <span className="sr-only">Unread</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

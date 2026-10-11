/**
 * Platform · Shell · NavPanel
 *
 * The one dropdown behind `More`, `Company`, the section picker and the module
 * overflow. One component because four menus that each close slightly
 * differently is four bugs: this one closes on Escape, on a click outside, and
 * on choosing something, and gives focus back to the button that opened it.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

export interface NavPanelItem {
  key: string;
  label: string;
  to: string;
  search?: Record<string, string>;
  description?: string;
  badge?: number;
  current?: boolean;
  soon?: string;
}

export interface NavPanelGroup {
  heading?: string;
  items: NavPanelItem[];
}

export function NavPanel({
  id,
  open,
  onClose,
  trigger,
  groups,
  footer,
  align = "left",
  full = false,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  groups: NavPanelGroup[];
  footer?: ReactNode;
  align?: "left" | "right";
  full?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        trigger.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    // Focus the first item, so a keyboard user who opened it is inside it.
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onClose, trigger]);

  if (!open) return null;

  return (
    <div
      id={id}
      ref={panel}
      role="menu"
      className={cn(
        "absolute top-full z-40 mt-1 max-h-[min(62dvh,420px)] overflow-auto rounded-lg border border-border-strong bg-popover p-1.5 shadow-overlay",
        full ? "inset-x-0" : "min-w-[214px] max-w-[min(360px,calc(100vw-24px))]",
        !full && (align === "right" ? "right-0" : "left-0"),
      )}
    >
      {groups.map((g, gi) => (
        <div key={g.heading ?? gi} role="group" aria-label={g.heading}>
          {g.heading && (
            <p className="px-2.5 pt-2 pb-1 text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
              {g.heading}
            </p>
          )}
          {g.items.map((item) =>
            item.soon ? (
              <span
                key={item.key}
                role="menuitem"
                aria-disabled="true"
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-nav text-muted-foreground"
              >
                {item.label}
                <span className="ml-auto text-2xs tracking-wide uppercase">soon</span>
              </span>
            ) : (
              <Link
                key={item.key}
                to={item.to}
                search={item.search as never}
                role="menuitem"
                aria-current={item.current ? "page" : undefined}
                onClick={onClose}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-nav",
                  item.current
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-foreground-secondary hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="min-w-0">
                  {item.label}
                  {item.description && (
                    <span className="block text-caption font-normal text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
                {!!item.badge && (
                  <span className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 font-mono text-table-header text-destructive-foreground tabular-nums">
                    {item.badge}
                  </span>
                )}
              </Link>
            ),
          )}
        </div>
      ))}
      {footer && (
        <p className="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-caption text-muted-foreground">
          {footer}
        </p>
      )}
    </div>
  );
}

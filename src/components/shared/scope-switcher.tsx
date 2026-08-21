/**
 * The module switcher.
 *
 * One control, top-left, that decides which world the shell is showing: the
 * organisation, or one module. Everything below it — the sidebar, the mobile
 * tab bar, the settings page it links to — follows the choice.
 *
 * It renders whatever `getWorkspaceScopes` resolved and names no module itself.
 * Modules the workspace cannot enter are listed too, greyed, with the reason:
 * an administrator wondering where Attendance went is better served by seeing
 * it disabled than by an interface behaving as though it never existed. Same
 * judgement the navigation contract's `soon:` already makes.
 *
 * Hidden entirely when there is nothing to switch between. A menu with one
 * entry is a control that teaches somebody it does nothing.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { UnavailableScope, WorkspaceScope } from "@/platform/modules";
import { cn } from "@/lib/utils";

function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden focusable="false">
      <circle cx="12" cy="5" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="19" r="1.75" fill="currentColor" />
    </svg>
  );
}

export function ScopeSwitcher({
  scopes,
  unavailable,
  current,
}: {
  scopes: readonly WorkspaceScope[];
  unavailable: readonly UnavailableScope[];
  current: WorkspaceScope | undefined;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Escape closes, and closing returns focus to the button. A menu dismissed
  // into nowhere strands a keyboard at the top of the document.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (scopes.length <= 1 && unavailable.length === 0) return null;

  function choose(scope: WorkspaceScope) {
    setOpen(false);
    // The scope's first destination, because a scope is not itself an address.
    // `getWorkspaceScopes` drops any scope with no destinations, so this is
    // never reaching into an empty list.
    const first = scope.items.find((i) => i.to);
    if (first?.to) void navigate({ to: first.to });
  }

  return (
    <div ref={wrapper} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="scope-menu"
        data-testid="scope-switcher"
        className="inline-flex h-12 max-w-[10rem] items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-secondary sm:max-w-none"
      >
        <KebabIcon />
        <span className="truncate">{current?.name ?? "Organisation"}</span>
      </button>

      {open && (
        <div
          id="scope-menu"
          role="menu"
          aria-label="Switch module"
          className="absolute left-0 top-full z-30 mt-1 min-w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {scopes.map((scope) => (
            <button
              key={scope.key}
              type="button"
              role="menuitem"
              onClick={() => choose(scope)}
              data-testid={`scope-${scope.key}`}
              className={cn(
                "flex h-12 w-full items-center rounded-md px-3 text-left text-sm",
                scope.key === current?.key
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {scope.name}
            </button>
          ))}

          {unavailable.length > 0 && (
            <>
              <div className="my-1 border-t border-border" role="separator" />
              {unavailable.map((m) => (
                <span
                  key={m.key}
                  data-testid={`scope-unavailable-${m.key}`}
                  className="flex h-12 items-center justify-between gap-3 rounded-md px-3 text-sm text-muted-foreground/60"
                >
                  {m.name}
                  <span className="text-2xs uppercase tracking-wide">{m.reason}</span>
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

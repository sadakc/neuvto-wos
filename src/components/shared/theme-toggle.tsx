/**
 * Switches between Nocturne and the light theme, and remembers the choice.
 *
 * The employee app defaults to dark because of when leave gets checked — late,
 * in bed, on a phone. That is a good default and a bad mandate: dark text on a
 * light ground is easier to read for people with astigmatism, and imposing the
 * default on them trades their comfort for everyone else's. A toggle costs one
 * button.
 *
 * Not rendered in the console, which is always light on purpose (theme.ts).
 */

import { useEffect, useState } from "react";
import { applyTheme, readPreference, setPreference } from "@/platform/design/theme";
import type { ThemeName } from "@/platform/design/tokens";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  // Starts null rather than guessing. The theme is decided by a script in
  // <head> before React exists, and rendering a guess here would flash the
  // wrong icon on every load for anyone whose choice differs from the default.
  const [theme, setTheme] = useState<ThemeName | null>(null);

  useEffect(() => {
    const stored = readPreference();
    setTheme(
      stored === "system"
        ? document.documentElement.classList.contains("dark")
          ? "dark"
          : "light"
        : stored,
    );
  }, []);

  if (theme === null) {
    // Holds the space so the header does not reflow when this resolves.
    return <span className={cn("inline-block h-12 w-12", className)} aria-hidden />;
  }

  const next: ThemeName = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        setPreference(next);
        setTheme(next);
      }}
      // The label says what pressing it DOES, not what the current state is —
      // "Dark mode" on a button is ambiguous about whether it is describing or
      // promising. A screen reader user gets the promise.
      aria-label={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
      title={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
      className={cn(
        "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      {/* Inline SVG rather than an icon dependency: two shapes, and the icon
          set this project uses is not worth pulling in for them. `currentColor`
          keeps them on the same token as the rest of the header. */}
      {next === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

/** Re-applies the stored theme after a client-side navigation. */
export function useThemeOnNavigation(pathname: string): void {
  useEffect(() => {
    const stored = readPreference();
    if (stored !== "system") applyTheme(stored);
  }, [pathname]);
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

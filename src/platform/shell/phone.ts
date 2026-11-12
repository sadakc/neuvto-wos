/**
 * Platform · Shell · The phone layout's decisions (doc 11)
 *
 * Under 600px the desktop shell is replaced, not adapted: a 64px app bar, an
 * 80px bottom bar, a tile home per module and a title menu, and no tab row at
 * any level. These are the pure parts, so the rules are tests rather than
 * something checked by eye.
 */

import type { ShellModule, ShellTab } from "./model";

/** Below this stage width the phone shell replaces the desktop one. */
export const PHONE_WIDTH = 600;

export const isPhoneWidth = (width: number) => width > 0 && width < PHONE_WIDTH;

/** The tab a module opens on: the one it names, else its first. */
export function moduleHome(m: ShellModule): ShellTab | null {
  return m.tabs.find((t) => t.id === m.homeTabId) ?? m.tabs.find((t) => !t.soon) ?? null;
}

export interface SheetGroup {
  heading: string;
  tabs: ShellTab[];
}

/**
 * A module's sections as the sheet groups them: its own, For your team, then
 * Company. A group with nothing in it is left out, heading and all.
 */
export function sectionGroups(m: ShellModule): SheetGroup[] {
  const by = (g: ShellTab["group"]) => m.tabs.filter((t) => t.group === g);
  return [
    { heading: "For you", tabs: by("main") },
    { heading: "For your team", tabs: by("team") },
    { heading: "Company", tabs: by("company") },
  ].filter((g) => g.tabs.length > 0);
}

/**
 * The tiles on a module's home: one per other section the person may open,
 * Company's folded into one full-width tile that opens the sheet there.
 */
export function homeTiles(m: ShellModule): { tiles: ShellTab[]; company: number } {
  const home = moduleHome(m);
  return {
    tiles: m.tabs.filter((t) => t.group !== "company" && t.id !== home?.id),
    company: m.tabs.filter((t) => t.group === "company").length,
  };
}

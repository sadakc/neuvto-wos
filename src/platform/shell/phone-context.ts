/**
 * Platform · Shell · A screen's own sections, on a phone (doc 11.4)
 *
 * A screen whose content is divided into sections (a person's record,
 * Configuration, Settings) declares them, and the app bar carries them: with
 * nothing chosen the screen shows its index, a list of its sections; with one
 * chosen it shows that section alone, and the title menu lists its siblings.
 *
 * `usePhone()` says whether the phone shell is in charge, so a screen renders
 * its index-or-section form only there. Above 600px nothing changes.
 */

import { createContext, useContext, useEffect } from "react";

export interface SubNavItem {
  id: string;
  label: string;
  /** One line under it in the index and the sheet. */
  hint?: string;
  /** The sheet's group heading. Items without one share the screen's title. */
  group?: string;
  badge?: number;
}

export interface SubNav {
  /** What the sheet is titled, and the app bar's subtitle in a section. */
  title: string;
  items: SubNavItem[];
  /** The section shown; "" for the index. */
  current: string;
  select: (id: string) => void;
  /** Back to the index: what the back arrow does inside a section. */
  clear: () => void;
}

export interface PhoneState {
  phone: boolean;
  sub: SubNav | null;
  setSub: (sub: SubNav | null) => void;
}

export const PhoneContext = createContext<PhoneState>({
  phone: false,
  sub: null,
  setSub: () => {},
});

/** True while the phone shell is showing (under 600px). */
export function usePhone(): boolean {
  return useContext(PhoneContext).phone;
}

/** What the current screen declared, for the app bar. */
export function useDeclaredSubNav(): SubNav | null {
  return useContext(PhoneContext).sub;
}

/**
 * Declare this screen's sections to the app bar while it is mounted. Pass null
 * when the screen has none to declare (above 600px, or a short screen).
 * Re-declared when what it shows changes; withdrawn when it unmounts.
 */
export function useSubNav(sub: SubNav | null) {
  const { setSub } = useContext(PhoneContext);
  const key = sub
    ? `${sub.title}|${sub.current}|${sub.items.map((i) => `${i.id}:${i.badge ?? ""}`).join(",")}`
    : "";
  useEffect(() => {
    setSub(sub);
    return () => setSub(null);
    // `sub` is rebuilt every render; what it says is `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSub]);
}

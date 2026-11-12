/**
 * Platform · Shell · A notice opens the part of a screen it is about
 *
 * Sada, 27 Oct 2026: pressing a notice must land on that section, not just
 * the page. A link carries the section as its anchor (`/app/leave#leave-<id>`).
 * The shell hands the anchor to the screen (`useAnchor`), so a screen with
 * sections of its own can open the right one, and scrolls to the element with
 * that id once it has rendered, marking it for a moment.
 */

import { createContext, useContext } from "react";

export const AnchorContext = createContext("");

/** The current link's anchor, without the `#`; "" for none. */
export function useAnchor(): string {
  return useContext(AnchorContext);
}

/** How long to wait for a lazy screen to render the element. */
const WAIT_MS = 5000;
const EVERY_MS = 150;

/**
 * Scroll to `#id` once it exists, clear of the sticky bar `offset` px tall,
 * and mark it with `data-anchored` for two seconds. Returns a cancel.
 */
export function scrollToAnchor(id: string, offset: number): () => void {
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tryNow = () => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo?.({ top: Math.max(0, top), behavior: "smooth" });
      el.setAttribute("data-anchored", "true");
      timer = setTimeout(() => el.removeAttribute("data-anchored"), 2000);
      return;
    }
    waited += EVERY_MS;
    if (waited < WAIT_MS) timer = setTimeout(tryNow, EVERY_MS);
  };
  timer = setTimeout(tryNow, 0);
  return () => clearTimeout(timer);
}

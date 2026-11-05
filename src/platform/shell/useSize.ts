/**
 * Platform · Shell · Measuring
 *
 * The rail and the tab bar decide what to show from measured widths, so they
 * must re-decide whenever a width changes: a window resize, a sidebar
 * appearing, a font finishing loading. ResizeObserver catches all three, which
 * a window `resize` listener does not; a late web font changes every tab's
 * width without the window changing at all, and a tab bar fitted against the
 * fallback font then overflows once Plex arrives.
 */

import { useLayoutEffect, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * Takes the ELEMENT, not a ref object, and callers hold it in state through a
 * callback ref (`ref={setEl}`).
 *
 * A ref object does not re-run an effect when its `.current` changes, and that
 * was a real bug: the rail's row only exists in row mode, the first render is
 * column mode, so a hook keyed on the ref attached to nothing, the row
 * measured 0px forever, and at 834px the rail showed one module and an
 * overflow chip with room for all of them. Keyed on the element, the observer
 * attaches when the element appears and moves when it is replaced.
 */
export function useSize(el: HTMLElement | null): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!el) return;
    const read = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    // Fonts change widths without changing the element's box.
    void document.fonts?.ready.then(read);
    return () => observer.disconnect();
  }, [el]);

  return size;
}

/**
 * Neuvto's own mark — the isometric N.
 *
 * ── where this belongs, and where it must not go
 *
 * **Not in the tenant workspace.** D45 says a customer's workspace should look
 * like the customer's, and `src/routes/app/route.tsx` renders THEIR logo in the
 * header. Falling back to this mark when a customer has not uploaded one would
 * make an unbranded workspace look like Neuvto's own product, which is the
 * precise opposite of the decision. An empty slot is correct there.
 *
 * This belongs on the surfaces that genuinely are Neuvto: the landing page,
 * sign-in and invitation acceptance, and the platform console.
 *
 * ── the mark is decoration next to a wordmark, and content on its own
 *
 * Where the word "neuvto" is already beside it, the image is `aria-hidden` with
 * an empty alt — a screen reader announcing "Neuvto logo Neuvto" is noise. Where
 * the mark stands alone it carries the name as its alt text. `decorative` picks
 * between the two, and defaults to the safer of them.
 *
 * The pack asks for clear space of at least 25% of the mark's width. The PNG
 * already carries ~15% internal padding, so the remainder comes from layout
 * `gap` at the call site rather than from padding baked in here.
 */

import { cn } from "@/lib/utils";
import markSrc from "@/assets/neuvto-mark.png";

/**
 * Rendered pixel sizes. The mark's 3D faces lose definition below 32px — the
 * pack says use the favicon there instead — so 32 is the floor and there is no
 * smaller step to reach for.
 */
const SIZES = {
  sm: "h-8 w-8", // 32px — the documented minimum
  md: "h-10 w-10",
  lg: "h-16 w-16",
} as const;

export function NeuvtoMark({
  size = "sm",
  decorative = true,
  className,
}: {
  size?: keyof typeof SIZES;
  /** True when a visible "neuvto" wordmark sits beside it. */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <img
      src={markSrc}
      // 512px source for a 32–64px slot: that is the 3× retina case with room
      // to spare, and the file is 120KB once, cached thereafter.
      width={512}
      height={512}
      alt={decorative ? "" : "Neuvto"}
      aria-hidden={decorative || undefined}
      className={cn("shrink-0 select-none object-contain", SIZES[size], className)}
    />
  );
}

/**
 * The mark and the wordmark together, as one thing.
 *
 * The wordmark is set in the display face with the full stop in `--primary`,
 * which is how it was already drawn on the landing page — kept identical here
 * so adopting this component changed nothing visually except adding the mark.
 */
export function NeuvtoLockup({
  size = "sm",
  className,
  wordmarkClassName,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <NeuvtoMark size={size} />
      <span className={cn("font-display text-xl font-bold tracking-tight", wordmarkClassName)}>
        neuvto<span className="text-primary">.</span>
      </span>
    </span>
  );
}

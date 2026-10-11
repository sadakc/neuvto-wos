/**
 * Platform · Shell · The two navigation algorithms
 *
 * DESIGN_SYSTEM §7, implemented exactly rather than approximated. Both are
 * pure: they take measured widths and return what to show. The components
 * measure; these decide. That split is what makes "nothing ever scrolls
 * sideways and the active tab is never hidden" a test matrix rather than
 * something checked by eye at four widths.
 */

/** Below this bar width the tab row collapses to a single section picker. */
export const PICK_WIDTH = 540;
/** The design's allowance for the bar's own padding and rounding. */
export const BAR_SLACK = 30;
/** Room reserved for the red count `More` may grow when a hidden tab is badged. */
export const BADGE_ALLOWANCE = 28;

export interface TabFitInput {
  /** `clientWidth` of the bar. */
  barWidth: number;
  /** Measured width of each main tab, in display order. */
  tabWidths: readonly number[];
  /** Index into `tabWidths` of the active tab, or -1 when it is not a main tab. */
  activeIndex: number;
  /** The `Company` button plus its separator. 0 when the role has no Company tabs. */
  fixedWidth: number;
  /** The `More` button at its widest. */
  moreWidth: number;
  /**
   * The "N tabs hidden for this role" note, or null when nothing is hidden.
   * Null and 0 are different: a note that measured 0px (before fonts load, or
   * where layout cannot be measured) still exists and must still be shown.
   */
  roleNoteWidth: number | null;
  /** Pending count per tab, same order as `tabWidths`. 0 for none. */
  badges: readonly number[];
}

export type TabFit =
  | { mode: "pick" }
  | {
      mode: "row";
      /** Per tab, same order as the input. */
      visible: boolean[];
      showMore: boolean;
      showRoleNote: boolean;
      /** How many tabs sit behind `More`. */
      moreCount: number;
      /** Sum of the pending counts behind `More`; 0 means no red badge. */
      moreBadge: number;
    };

export function fitTabs(input: TabFitInput): TabFit {
  const { barWidth, tabWidths, activeIndex, fixedWidth, moreWidth, roleNoteWidth, badges } = input;
  if (barWidth < PICK_WIDTH) return { mode: "pick" };

  const all = tabWidths.map(() => true);
  const available = barWidth - BAR_SLACK - fixedWidth;
  const total = tabWidths.reduce((a, b) => a + b, 0);

  // Steps 3 and 4: everything fits, with or without the role note.
  if (total + (roleNoteWidth ?? 0) <= available) {
    return row(all, false, roleNoteWidth !== null, badges);
  }
  if (total <= available) return row(all, false, false, badges);

  // Step 5: `More` is needed. Badged tabs might end up behind it, and then it
  // grows a count, so that room is reserved up front rather than discovered.
  const anyBadge = badges.some((b) => b > 0);
  const budget = available - moreWidth - (anyBadge ? BADGE_ALLOWANCE : 0);

  // Step 6: the first tab that does not fit is the cut.
  let used = 0;
  let cut = tabWidths.length;
  for (let i = 0; i < tabWidths.length; i++) {
    if (used + tabWidths[i] > budget) {
      cut = i;
      break;
    }
    used += tabWidths[i];
  }
  const visible = tabWidths.map((_, i) => i < cut);

  // Step 7: the active tab is never the one hidden. Somebody must never land
  // on a page whose tab they cannot see.
  promote(visible, tabWidths, activeIndex, budget);

  return row(visible, true, false, badges);
}

function row(
  visible: boolean[],
  showMore: boolean,
  showRoleNote: boolean,
  badges: readonly number[],
): TabFit {
  const hidden = visible.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  return {
    mode: "row",
    visible,
    showMore: showMore && hidden.length > 0,
    showRoleNote,
    moreCount: hidden.length,
    moreBadge: hidden.reduce((sum, i) => sum + (badges[i] ?? 0), 0),
  };
}

/* ── Algorithm 2: the module rail ─────────────────────────────────────────── */

export type RailMode = "column" | "row" | "grid";

/** Column above 1000px, row from 540 to 1000, a 2-up grid below 540. */
export function railMode(stageWidth: number): RailMode {
  if (stageWidth > 1000) return "column";
  if (stageWidth >= PICK_WIDTH) return "row";
  return "grid";
}

/** The phone grid shows at most four modules; the rest sit behind "All N modules". */
export const GRID_CAP = 4;

export interface RailFitInput {
  mode: RailMode;
  /** Width of the row the chips sit in. Only read in `row` mode. */
  rowWidth: number;
  /** Measured width of each module chip, in display order. Only read in `row` mode. */
  chipWidths: readonly number[];
  /** The `Modules` overflow chip at its widest. */
  overflowWidth: number;
  activeIndex: number;
  badges: readonly number[];
}

export interface RailFit {
  visible: boolean[];
  /** Behind the overflow control. 0 means no overflow control. */
  hiddenCount: number;
  /** Sum of pending counts behind it. */
  hiddenBadge: number;
}

export function fitRail(input: RailFitInput): RailFit {
  const { mode, rowWidth, chipWidths, overflowWidth, activeIndex, badges } = input;
  const n = badges.length;

  if (mode === "column") return rail(Array(n).fill(true), badges);

  if (mode === "grid") {
    // Exactly four slots fill a 2-up grid with no orphan. Five or more modules
    // means three plus "All N modules" spanning the row beneath them.
    if (n <= GRID_CAP) return rail(Array(n).fill(true), badges);
    const visible = Array.from({ length: n }, (_, i) => i < GRID_CAP - 1);
    // Every grid tile is the same width, so count stands in for width here.
    promote(
      visible,
      visible.map(() => 1),
      activeIndex,
      GRID_CAP - 1,
    );
    return rail(visible, badges);
  }

  const gap = 6;
  const total = chipWidths.reduce((a, b) => a + b + gap, 0);
  if (total <= rowWidth) return rail(Array(n).fill(true), badges);

  const budget = rowWidth - overflowWidth - gap;
  let used = 0;
  let cut = n;
  for (let i = 0; i < n; i++) {
    if (used + chipWidths[i] + gap > budget) {
      cut = i;
      break;
    }
    used += chipWidths[i] + gap;
  }
  const visible = Array.from({ length: n }, (_, i) => i < cut);
  promote(
    visible,
    chipWidths.map((w) => w + gap),
    activeIndex,
    budget,
  );
  return rail(visible, badges);
}

/**
 * Step 7, shared by both algorithms: show the active item, then demote from the
 * right until what is shown fits the budget again.
 *
 * The design states this as "un-hide the active tab and hide the last visible
 * non-active tab instead", a one-for-one swap. That swap overflows whenever the
 * active tab is wider than the tab it displaces (Leave's "Comp Off" active at a
 * 610px bar spilled 16px), which the matrix in fit.test.ts found. Demoting until
 * it fits is what the swap was for, so this is the swap made true rather than a
 * different rule. The one case that cannot fit is the active item alone being
 * wider than the budget; it is shown anyway, and the bar clips rather than the
 * page scrolling.
 */
function promote(
  visible: boolean[],
  widths: readonly number[],
  activeIndex: number,
  budget: number,
) {
  if (activeIndex < 0 || visible[activeIndex]) return;
  visible[activeIndex] = true;
  let used = widths.reduce((s, w, i) => s + (visible[i] ? w : 0), 0);
  for (let i = visible.length - 1; i >= 0 && used > budget; i--) {
    if (i !== activeIndex && visible[i]) {
      visible[i] = false;
      used -= widths[i];
    }
  }
}

function rail(visible: boolean[], badges: readonly number[]): RailFit {
  let hiddenCount = 0;
  let hiddenBadge = 0;
  visible.forEach((v, i) => {
    if (!v) {
      hiddenCount++;
      hiddenBadge += badges[i] ?? 0;
    }
  });
  return { visible, hiddenCount, hiddenBadge };
}

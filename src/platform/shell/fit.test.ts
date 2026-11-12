/**
 * The navigation algorithms, as a matrix.
 *
 * DESIGN_SYSTEM §7 says nothing scrolls sideways and the active tab is never
 * hidden, for every module, every role and every width. Checking that by eye
 * at four widths is how a fifth width ships broken, so it is asserted here for
 * every bar width from 300 to 1600px and every choice of active tab.
 */

import { describe, expect, it } from "vitest";
import {
  BADGE_ALLOWANCE,
  BAR_SLACK,
  fitRail,
  fitTabs,
  GRID_CAP,
  PICK_WIDTH,
  railMode,
  type TabFitInput,
} from "./fit";

/** Leave's real labels at 13.5px Plex, roughly: what the shell will measure. */
const LEAVE = [96, 112, 92, 88, 104];
const MORE = 82;
const COMPANY = 110;

function input(over: Partial<TabFitInput> = {}): TabFitInput {
  return {
    barWidth: 1200,
    tabWidths: LEAVE,
    activeIndex: 0,
    fixedWidth: COMPANY,
    moreWidth: MORE,
    roleNoteWidth: null,
    badges: LEAVE.map(() => 0),
    ...over,
  };
}

describe("fitTabs, step by step", () => {
  it("collapses to the section picker below 540px", () => {
    expect(fitTabs(input({ barWidth: PICK_WIDTH - 1 })).mode).toBe("pick");
    expect(fitTabs(input({ barWidth: PICK_WIDTH })).mode).toBe("row");
  });

  it("shows every tab and the role note when both fit", () => {
    const fit = fitTabs(input({ roleNoteWidth: 160 }));
    expect(fit).toMatchObject({ mode: "row", showMore: false, showRoleNote: true, moreCount: 0 });
  });

  it("drops the role note first, before any tab", () => {
    // 492 of tabs + 110 company + 30 slack = 632; a 160px note does not fit in 700.
    const fit = fitTabs(input({ barWidth: 700, roleNoteWidth: 160 }));
    expect(fit).toMatchObject({ mode: "row", showMore: false, showRoleNote: false });
    if (fit.mode === "row") expect(fit.visible.every(Boolean)).toBe(true);
  });

  it("cuts at the first tab that does not fit, and everything after it", () => {
    // 600 - 30 - 110 - 82 = 378 of budget: 96 + 112 + 92 = 300 fits, +88 does not.
    const fit = fitTabs(input({ barWidth: 600 }));
    expect(fit.mode === "row" && fit.visible).toEqual([true, true, true, false, false]);
    expect(fit).toMatchObject({ showMore: true, moreCount: 2 });
  });

  it("promotes a hidden active tab and demotes the last visible one instead", () => {
    const fit = fitTabs(input({ barWidth: 600, activeIndex: 4 }));
    expect(fit.mode === "row" && fit.visible).toEqual([true, true, false, false, true]);
  });

  it("keeps demoting when the promoted tab is wider than the one it displaced", () => {
    // The design's literal one-for-one swap overflowed here by 16px.
    const fit = fitTabs(
      input({ barWidth: 610, activeIndex: 4, tabWidths: [96, 112, 92, 88, 160] }),
    );
    expect(fit.mode === "row" && fit.visible).toEqual([true, true, false, false, true]);
  });

  it("reserves room for a badge before deciding the cut", () => {
    // 620 - 30 - 110 - 82 = 398: four tabs (388) fit quietly; less the 28px
    // badge allowance (370), only three do.
    const quiet = fitTabs(input({ barWidth: 620 }));
    const badged = fitTabs(input({ barWidth: 620, badges: [0, 0, 0, 0, 6] }));
    const shown = (f: ReturnType<typeof fitTabs>) =>
      f.mode === "row" ? f.visible.filter(Boolean).length : 0;
    expect(shown(badged)).toBeLessThan(shown(quiet));
  });

  it("carries the hidden tabs' pending count onto More", () => {
    const fit = fitTabs(input({ barWidth: 600, badges: [0, 0, 0, 0, 6] }));
    expect(fit).toMatchObject({ moreBadge: 6 });
  });

  it("an active tab outside the main group (-1) never forces a promotion", () => {
    const fit = fitTabs(input({ barWidth: 600, activeIndex: -1 }));
    expect(fit.mode === "row" && fit.visible).toEqual([true, true, true, false, false]);
  });
});

describe("fitTabs, the matrix", () => {
  const sets: Array<[string, number[]]> = [
    ["leave", LEAVE],
    ["one tab", [120]],
    ["eight long tabs", [140, 150, 160, 130, 170, 120, 180, 150]],
    ["twelve short tabs", Array(12).fill(70)],
  ];

  for (const [name, widths] of sets) {
    it(`${name}: never wider than the bar, never hides the active tab, never loses one`, () => {
      for (let bar = 300; bar <= 1600; bar += 10) {
        for (let active = -1; active < widths.length; active++) {
          for (const badged of [false, true]) {
            const badges = widths.map((_, i) => (badged && i === widths.length - 1 ? 3 : 0));
            const fit = fitTabs(
              input({ barWidth: bar, tabWidths: widths, activeIndex: active, badges }),
            );
            const at = `${name}, bar ${bar}, active ${active}, badged ${badged}`;

            if (bar < PICK_WIDTH) {
              expect(fit.mode, at).toBe("pick");
              continue;
            }
            if (fit.mode !== "row") throw new Error(at);

            expect(fit.visible, at).toHaveLength(widths.length);
            if (active >= 0) expect(fit.visible[active], `${at}: active hidden`).toBe(true);
            expect(fit.moreCount, at).toBe(fit.visible.filter((v) => !v).length);

            const used =
              widths.reduce((s, w, i) => s + (fit.visible[i] ? w : 0), 0) +
              COMPANY +
              (fit.showMore ? MORE + (fit.moreBadge > 0 ? BADGE_ALLOWANCE : 0) : 0);
            // One exception, by design: when the active tab alone is wider than
            // the budget, it is shown anyway. Being able to see where you are
            // outranks a few pixels; the bar clips, the page does not scroll.
            const onlyActive = fit.visible.filter(Boolean).length === 1 && active >= 0;
            if (!onlyActive) expect(used, `${at}: overflows`).toBeLessThanOrEqual(bar - BAR_SLACK);
          }
        }
      }
    });
  }
});

describe("railMode", () => {
  it("is a column above 1000, a row from 540, a grid below", () => {
    expect(railMode(1440)).toBe("column");
    expect(railMode(1001)).toBe("column");
    expect(railMode(1000)).toBe("row");
    expect(railMode(540)).toBe("row");
    expect(railMode(539)).toBe("grid");
    expect(railMode(320)).toBe("grid");
  });
});

describe("fitRail", () => {
  const twelve = Array(12).fill(0);

  it("shows everything in a column", () => {
    expect(
      fitRail({
        mode: "column",
        rowWidth: 0,
        chipWidths: [],
        overflowWidth: 0,
        activeIndex: 0,
        badges: twelve,
      }).hiddenCount,
    ).toBe(0);
  });

  it("caps the phone grid at four, so the 2-up grid never orphans a tile", () => {
    for (let n = 1; n <= 12; n++) {
      const fit = fitRail({
        mode: "grid",
        rowWidth: 0,
        chipWidths: [],
        overflowWidth: 0,
        activeIndex: 0,
        badges: Array(n).fill(0),
      });
      const tiles = fit.visible.filter(Boolean).length + (fit.hiddenCount > 0 ? 1 : 0);
      expect(tiles, `${n} modules`).toBeLessThanOrEqual(GRID_CAP);
    }
  });

  it("keeps the active module on the grid even when it is the twelfth", () => {
    const fit = fitRail({
      mode: "grid",
      rowWidth: 0,
      chipWidths: [],
      overflowWidth: 0,
      activeIndex: 11,
      badges: twelve,
    });
    expect(fit.visible[11]).toBe(true);
    expect(fit.visible.filter(Boolean)).toHaveLength(GRID_CAP - 1);
  });

  it("combines the badges behind All N modules", () => {
    const badges = twelve.map((_, i) => (i === 9 ? 4 : i === 10 ? 2 : 0));
    expect(
      fitRail({
        mode: "grid",
        rowWidth: 0,
        chipWidths: [],
        overflowWidth: 0,
        activeIndex: 0,
        badges,
      }).hiddenBadge,
    ).toBe(6);
  });

  it("row mode: fits twelve modules into any width without overflow, active always shown", () => {
    const chips = twelve.map((_, i) => 90 + (i % 3) * 20);
    for (let w = 540; w <= 1000; w += 10) {
      for (let active = 0; active < 12; active++) {
        const fit = fitRail({
          mode: "row",
          rowWidth: w,
          chipWidths: chips,
          overflowWidth: 100,
          activeIndex: active,
          badges: twelve,
        });
        expect(fit.visible[active], `width ${w}, active ${active}`).toBe(true);
        const used =
          chips.reduce((s, c, i) => s + (fit.visible[i] ? c + 6 : 0), 0) +
          (fit.hiddenCount ? 106 : 0);
        expect(used, `width ${w}, active ${active}`).toBeLessThanOrEqual(w);
      }
    }
  });
});

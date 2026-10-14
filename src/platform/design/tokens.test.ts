/**
 * The palette is proven here, not judged by eye.
 *
 * Every "is this readable?" question about a colour has a numeric answer, and
 * the alternative to computing it is looking at the screen and deciding it
 * seems fine — which is how a `text-muted-foreground` caption that nobody with
 * ordinary eyesight can read on a phone in daylight ships. Dark mode makes this
 * worse, not better: a pairing that is comfortable at night on a laptop can be
 * well under AA, and the person who cannot read it is not in the room.
 *
 * So: the token file may not be merged in a state where any text pairing fails
 * WCAG AA. Changing a colour and watching this fail is the point.
 */

import { describe, expect, it } from "vitest";
import { contrastRatio, hexToOklch, isInSrgbGamut, oklchToHex, oklchToRgb } from "./color";
import { SEMANTIC, RADIUS, SPACE, TYPE, type SemanticToken, type ThemeName } from "./tokens";

const THEMES: ThemeName[] = ["light", "dark"];

/** WCAG AA for body text. */
const AA_TEXT = 4.5;
/** WCAG AA for large text (≥24px, or ≥19px bold) and for UI boundaries (1.4.11). */
const AA_LARGE = 3;

/**
 * Foreground → background pairings that carry text a person has to read.
 *
 * Read this as the list of claims the palette makes. `[fg, bg]`.
 */
const TEXT_PAIRS: Array<[SemanticToken, SemanticToken]> = [
  ["foreground", "background"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["primaryForeground", "primary"],
  ["brandForeground", "brand"],
  ["secondaryForeground", "secondary"],
  ["accentForeground", "accent"],
  ["successForeground", "success"],
  ["warningForeground", "warning"],
  ["destructiveForeground", "destructive"],
  ["infoForeground", "info"],
  ["neutralForeground", "neutral"],

  // The brand hue used as TEXT rather than as a fill.
  //
  // Every pair above this line checks a foreground against the fill it sits on
  // — `primaryForeground` on `primary`. Not one of them checks the brand colour
  // itself being used as text on the page, which is what a section eyebrow is,
  // and which `primary` had been doing at 2.65:1 on every eyebrow of the
  // landing page. The suite was full and the defect was in the gap between its
  // entries.
  //
  // `secondary` stands in for the tinted band: `bg-secondary/40` composites to
  // a LIGHTER pixel than `secondary` itself, so asserting against the token is
  // the stricter of the two and cannot pass while the painted band fails.
  ["brandStrong", "background"],
  ["brandStrong", "card"],
  ["brandStrong", "secondary"],

  // Secondary text. The single most-skipped pairing in every design system,
  // and the one that fails most often — it is grey on purpose, and "grey
  // enough to be quiet" and "grey enough to be unreadable" are three tenths of
  // a lightness step apart.
  ["mutedForeground", "background"],
  ["mutedForeground", "card"],
  ["mutedForeground", "muted"],

  // Status badges drawn as tinted fills rather than solid ones: the label is
  // body-coloured text on the muted surface.
  ["foreground", "successMuted"],
  ["foreground", "warningMuted"],
  ["foreground", "destructiveMuted"],
  ["foreground", "infoMuted"],
  ["foreground", "neutralMuted"],
  ["foreground", "secondary"],
  ["foreground", "muted"],

  // Core HR (D76). Second-level text, and every pill: status text on its own
  // soft fill. The pill is the most common place a status word is read.
  ["foregroundSecondary", "background"],
  ["foregroundSecondary", "card"],
  ["foregroundSecondary", "muted"],
  ["primary", "background"],
  ["primary", "card"],
  ["success", "successMuted"],
  ["warning", "warningMuted"],
  ["destructive", "destructiveMuted"],
  ["info", "infoMuted"],
  ["success", "card"],
  ["warning", "card"],
  ["destructive", "card"],
];

/**
 * Things that are not text but must still be distinguishable: the boundary of
 * an input, and the focus ring. WCAG 1.4.11.
 *
 * `--border` is deliberately absent. It draws dividers and card edges, which
 * are decorative — 1.4.11 covers boundaries needed to IDENTIFY a control, and
 * holding a table rule to 3:1 produces a screen that looks like a spreadsheet.
 * `--input` is the one that outlines something you have to find and click.
 */
const BOUNDARY_PAIRS: Array<[SemanticToken, SemanticToken]> = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
];

describe.each(THEMES)("%s theme", (theme) => {
  const tokens = SEMANTIC[theme];

  it.each(TEXT_PAIRS)("%s on %s meets AA for body text", (fg, bg) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    expect(
      ratio,
      `${theme}: ${fg} (${oklchToHex(tokens[fg])}) on ${bg} (${oklchToHex(tokens[bg])}) ` +
        `is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(BOUNDARY_PAIRS)("%s against %s is a visible boundary", (fg, bg) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    expect(
      ratio,
      `${theme}: ${fg} (${oklchToHex(tokens[fg])}) on ${bg} (${oklchToHex(tokens[bg])}) ` +
        `is ${ratio.toFixed(2)}:1, needs ${AA_LARGE}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });

  // Out-of-gamut OKLCH gets clamped per channel on the way to sRGB, which
  // shifts hue as well as chroma. The web would render the OKLCH and native
  // would render the clamp, so the two platforms would disagree about a colour
  // while both looked individually plausible.
  it("every token survives conversion to sRGB without clipping", () => {
    const clipped = Object.entries(tokens)
      .filter(([, value]) => !isInSrgbGamut(value))
      .map(([name]) => name);
    expect(clipped, `out of sRGB gamut: ${clipped.join(", ")}`).toEqual([]);
  });

  it("declares every semantic token", () => {
    // Catches the half-finished theme: a token added to light, used in a
    // component, and missing on dark — which renders as `inherit` and is
    // usually invisible rather than obviously broken.
    expect(Object.keys(tokens).sort()).toEqual(Object.keys(SEMANTIC.light).sort());
  });
});

describe("themes are genuinely distinct", () => {
  it("the accent keeps its hue in both themes", () => {
    // Dark lifts the LIGHTNESS of the accent, it does not repaint it. The
    // prototype's two teals are 2 to 3 degrees apart, which is authoring
    // noise; a repaint would be tens of degrees. 8 degrees is the line.
    const delta = Math.abs(SEMANTIC.dark.primary.h - SEMANTIC.light.primary.h);
    expect(Math.min(delta, 360 - delta)).toBeLessThan(8);
  });

  it("no dark status colour is saturated enough to glare", () => {
    // The worry is a full-chroma green on a near-black screen at night. Under
    // Nocturne this was written as "dark is less saturated than light", which
    // only meant something while light used full-chroma statuses. Core HR's
    // light statuses are deep, low-chroma tones, so the rule is now stated
    // directly: a cap on chroma in the dark theme. The highest is the green,
    // at 0.125; #22C55E, the colour that motivated the rule, is 0.19.
    for (const token of ["success", "warning", "destructive", "info"] as const) {
      expect(SEMANTIC.dark[token].c, `${token} glares on dark`).toBeLessThanOrEqual(0.14);
    }
  });

  it("--ink does not flip between themes", () => {
    // It means "near-black", not "the strongest text colour". It paints things
    // that are deliberately dark in EITHER theme: the landing page's roadmap
    // band (`bg-ink text-white`) and the scrim behind the mobile menu.
    //
    // Making it flip turned that band into white-on-white and turned the scrim
    // into a white wash that lightened the page it was meant to dim. Neither
    // was visible in a diff.
    expect(SEMANTIC.dark.ink).toEqual(SEMANTIC.light.ink);
    // And it must actually be dark, or `text-white` on top of it fails.
    expect(contrastRatio({ l: 1, c: 0, h: 0 }, SEMANTIC.light.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark borders are opaque", () => {
    // A translucent border composites to a different colour over the page than
    // over a card, so only one of the two was ever checked.
    for (const token of ["border", "input"] as const) {
      expect(SEMANTIC.dark[token].alpha ?? 1).toBe(1);
    }
  });
});

describe("scales", () => {
  it("spacing stays on the 4px grid", () => {
    for (const [step, px] of Object.entries(SPACE)) {
      if (px < 4) continue; // 0.5 = 2px, the one deliberate half-step
      expect(px % 4, `space-${step} is ${px}px, off the 4px grid`).toBe(0);
    }
  });

  it("radius steps ascend", () => {
    const values = Object.values(RADIUS);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(Math.min(...values)).toBeGreaterThan(0);
  });

  it("inputs are at least 16px so iOS does not zoom on focus", () => {
    // Body text is 14px in Core HR; a FIELD is not body text. The rule binds
    // inputs, which use minInputSize on touch widths (DESIGN_SYSTEM §4).
    expect(TYPE.minInputSize).toBeGreaterThanOrEqual(16);
  });

  it("every type role has a line height with room to breathe", () => {
    for (const [role, spec] of Object.entries(TYPE.roles)) {
      expect(spec.lineHeight, `${role} line height is tighter than its size`).toBeGreaterThan(
        spec.size,
      );
    }
  });
});

describe("colour conversion", () => {
  // The conversion is load-bearing: it is what native renders from. Anchored on
  // values with known answers rather than on its own output.
  it("converts the brand blue to its published hex", () => {
    // #0EA5E9 is the authoritative brand value (DESIGN_SYSTEM §3). Within a
    // point per channel of the round trip through OKLCH.
    const [r, g, b] = oklchToRgb(SEMANTIC.light.brand);
    expect(Math.abs(r - 0x0e)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - 0xa5)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 0xe9)).toBeLessThanOrEqual(3);
  });

  it("hexToOklch is the exact inverse of oklchToHex", () => {
    // The Core HR tokens are authored as the prototype's hex codes. If this
    // drifted, a token would silently stop being the designed colour.
    for (const h of ["#0f5f79", "#52b4cf", "#f3f6f7", "#13212a", "#a62a20", "#000000", "#ffffff"]) {
      expect(oklchToHex(hexToOklch(h))).toBe(h);
    }
  });

  it("the palette is the Core HR prototype's, except where contrast required otherwise", () => {
    // Exactly three tokens differ from the prototype, each documented in the
    // header of tokens.ts with its measurement. A fourth difference is either
    // a deliberate fix that needs documenting there, or a mistake.
    const asDesigned: Array<[ThemeName, SemanticToken, string]> = [
      ["light", "background", "#f3f6f7"],
      ["light", "card", "#ffffff"],
      ["light", "foreground", "#13212a"],
      ["light", "foregroundSecondary", "#47585f"],
      ["light", "primary", "#0f5f79"],
      ["light", "accent", "#e0eef3"],
      ["light", "border", "#dce3e6"],
      ["light", "borderStrong", "#c5d1d5"],
      ["light", "success", "#2d7a48"],
      ["light", "destructive", "#a62a20"],
      ["dark", "background", "#0c1317"],
      ["dark", "card", "#141d22"],
      ["dark", "primary", "#52b4cf"],
      ["dark", "mutedForeground", "#7b8f98"],
    ];
    for (const [theme, token, want] of asDesigned) {
      expect(oklchToHex(SEMANTIC[theme][token]), `${theme}.${token}`).toBe(want);
    }
    expect(oklchToHex(SEMANTIC.light.mutedForeground)).toBe("#5a6c73"); // not #6d8087
    expect(oklchToHex(SEMANTIC.light.input)).toBe("#828d91"); // not --line-2
    expect(oklchToHex(SEMANTIC.dark.input)).toBe("#5e717a"); // not --line-2
  });

  it("round-trips the achromatic ends", () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe("#ffffff");
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe("#000000");
  });

  it("puts white on black at the textbook 21:1", () => {
    expect(contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 })).toBeCloseTo(21, 1);
  });
});

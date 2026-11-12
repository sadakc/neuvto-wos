/**
 * Platform · Design · Tokens
 *
 * **The single source of truth for every colour, radius, size and space in the
 * product.** `src/styles.css` is generated from this file — do not edit the
 * generated block by hand, edit this and run `bun run tokens`. CI fails if the
 * two disagree, so drift is caught rather than discovered.
 *
 * ── why the tokens live in TypeScript and not in the stylesheet
 *
 * A CSS custom property cannot be imported by React Native, so a palette kept
 * only in CSS gets retyped into a second file for the native app, and two
 * hand-maintained palettes drift within about a fortnight. Authoring here and
 * generating the CSS means web and native are the same numbers by
 * construction rather than by discipline.
 *
 * ── the three tiers (DESIGN_SYSTEM §2)
 *
 *   Tier 1  PRIMITIVE  raw values, named for what they look like.
 *   Tier 2  SEMANTIC   named for what they MEAN. The only tier a component
 *                      may consume — this is what lets a tenant set their
 *                      brand to green without a class called `blue` anywhere.
 *   Tier 3  COMPONENT  a component's own systematic deviation. Rare, and
 *                      lives with the component rather than here.
 *
 * ── the direction: Core HR (D76, 11 Oct 2026)
 *
 * Replaces Nocturne. The values are the Core HR Suite prototype's palette,
 * written as the prototype's own hex codes and converted by `hexToOklch`, so a
 * token here IS the designed colour rather than a hand-rounded copy of it.
 *
 * Three values differ from the prototype, each because it failed the contrast
 * suite in tokens.test.ts and each by the smallest same-hue step that passes:
 *
 *   · `mutedForeground` (the prototype's `--ink-3`) is #5a6c73 in light, not
 *     #6d8087. The prototype's value is 3.80:1 on the page and 3.66:1 on a
 *     grey panel; captions and hints are text, and AA asks 4.5:1 of text.
 *   · `input` is #828d91 light and #5e717a dark. The prototype borders its
 *     fields with `--line-2`, which is 1.56:1 — a field you cannot find on a
 *     phone in daylight. `borderStrong` keeps `--line-2` for decorative edges.
 *
 * Nothing else was adjusted. If a future design revision fails the suite,
 * the fix goes here with its measurement, never into the generated CSS.
 *
 * `brand` is deliberately NOT the product accent. It is Neuvto's published
 * sky blue, used by the landing page, the logo and the social card. The
 * product's working colour is `primary`, the Core HR teal. Repainting the
 * brand is a marketing decision, not a theme one, and is not made here.
 */

import { hexToOklch, type Oklch } from "./color";

export type ThemeName = "light" | "dark";

const hex = hexToOklch;

/* ── Tier 1 · Primitives ─────────────────────────────────────────────────────
 *
 * Named for appearance. **Never referenced by a component** — if you find
 * yourself importing one of these outside this file, the thing you want is a
 * semantic token that does not exist yet. Add it below instead.
 */

const P = {
  white: hex("#ffffff"),

  /* Core HR, light. Prototype names in the trailing comment. */
  ground: hex("#f3f6f7"), // --ground
  surface: hex("#ffffff"), // --surface
  surface2: hex("#eef2f4"), // --surface-2
  surface3: hex("#e4eaec"), // --surface-3
  ink: hex("#13212a"), // --ink
  ink2: hex("#47585f"), // --ink-2
  /** --ink-3 darkened from #6d8087 for AA. See the header. */
  ink3: hex("#5a6c73"),
  line: hex("#dce3e6"), // --line
  line2: hex("#c5d1d5"), // --line-2
  /** A field boundary that clears 3:1 (WCAG 1.4.11). Not in the prototype. */
  field: hex("#828d91"),
  teal: hex("#0f5f79"), // --accent
  tealSoft: hex("#e0eef3"), // --accent-soft
  tealLine: hex("#a5c8d5"), // --accent-line
  green: hex("#2d7a48"), // --ok
  greenSoft: hex("#e3f1e7"),
  greenLine: hex("#a9d3b7"),
  amber: hex("#94620a"), // --warn
  amberSoft: hex("#f8eed7"),
  amberLine: hex("#e0c58a"),
  red: hex("#a62a20"), // --bad
  redSoft: hex("#f9e6e4"),
  redLine: hex("#e7b2ac"),
  indigo: hex("#3f548e"), // --info
  indigoSoft: hex("#e8ebf6"),
  indigoLine: hex("#b3bede"),

  /* Core HR, dark. */
  dGround: hex("#0c1317"),
  dSurface: hex("#141d22"),
  dSurface2: hex("#1b262c"),
  dSurface3: hex("#243139"),
  dInk: hex("#e8eff2"),
  dInk2: hex("#a6b8c0"),
  dInk3: hex("#7b8f98"),
  dLine: hex("#25343b"),
  dLine2: hex("#35474f"),
  dField: hex("#5e717a"),
  dTeal: hex("#52b4cf"),
  dTealInk: hex("#052230"),
  dTealSoft: hex("#113240"),
  dTealLine: hex("#245d74"),
  dGreen: hex("#66c286"),
  dGreenSoft: hex("#142d1f"),
  dGreenLine: hex("#2c5c3c"),
  dAmber: hex("#dca63f"),
  dAmberSoft: hex("#31260f"),
  dAmberLine: hex("#5f4a18"),
  dRed: hex("#e98a80"),
  dRedSoft: hex("#341c19"),
  dRedLine: hex("#6b332c"),
  dIndigo: hex("#8fa3dd"),
  dIndigoSoft: hex("#1b2236"),
  dIndigoLine: hex("#3a456b"),

  /* Neuvto's published brand, for marketing surfaces only. `#0EA5E9` and the
   * darker step that reads as text on white (5.18:1). */
  sky500: { l: 0.6847, c: 0.1479, h: 237.32 },
  sky400: { l: 0.79, c: 0.118, h: 237.32 },
  sky750: { l: 0.53, c: 0.115, h: 237.32 },
  nearBlack: { l: 0.15, c: 0.012, h: 250 },
} as const satisfies Record<string, Oklch>;

/* ── Tier 2 · Semantic ───────────────────────────────────────────────────────
 *
 * The contract. Every key here becomes a CSS custom property of the same name
 * (camelCase → kebab-case) and a React Native colour of the same name.
 *
 * The shadcn names (background, card, muted…) are kept so every existing
 * screen re-themes without being touched; the Core HR additions sit beside
 * them. Prototype equivalents:
 *
 *   background ← --ground        card, popover ← --surface
 *   secondary, muted ← --surface-2   surface3 ← --surface-3
 *   foreground ← --ink   foregroundSecondary ← --ink-2   mutedForeground ← --ink-3
 *   border ← --line   borderStrong ← --line-2
 *   primary ← --accent   accent ← --accent-soft   accentLine ← --accent-line
 *   success/warning/destructive/info ← --ok/--warn/--bad/--info
 *   …Muted ← --*-soft   …Line ← --*-line
 */

export type SemanticToken =
  | "background"
  | "foreground"
  | "foregroundSecondary"
  | "card"
  | "cardForeground"
  | "popover"
  | "popoverForeground"
  | "surface3"
  | "primary"
  | "primaryForeground"
  | "brand"
  | "brandForeground"
  | "brandStrong"
  | "secondary"
  | "secondaryForeground"
  | "muted"
  | "mutedForeground"
  | "accent"
  | "accentForeground"
  | "accentLine"
  | "success"
  | "successForeground"
  | "successMuted"
  | "successLine"
  | "warning"
  | "warningForeground"
  | "warningMuted"
  | "warningLine"
  | "destructive"
  | "destructiveForeground"
  | "destructiveMuted"
  | "destructiveLine"
  | "info"
  | "infoForeground"
  | "infoMuted"
  | "infoLine"
  | "neutral"
  | "neutralForeground"
  | "neutralMuted"
  | "border"
  | "borderStrong"
  | "input"
  | "ring"
  | "ink";

export const SEMANTIC: Record<ThemeName, Record<SemanticToken, Oklch>> = {
  /** Light. What the console always renders in (see ./theme.ts). */
  light: {
    background: P.ground,
    foreground: P.ink,
    foregroundSecondary: P.ink2,
    card: P.surface,
    cardForeground: P.ink,
    popover: P.surface,
    popoverForeground: P.ink,
    surface3: P.surface3,

    primary: P.teal,
    /* White on the teal is 7.16:1. Nocturne had to put dark text on its sky
     * blue to reach AA; the Core HR accent is dark enough that it does not. */
    primaryForeground: P.white,
    brand: P.sky500,
    brandForeground: P.nearBlack,
    brandStrong: P.sky750,

    secondary: P.surface2,
    secondaryForeground: P.ink,
    muted: P.surface2,
    mutedForeground: P.ink3,
    /*
     * shadcn's `accent` is the hover and selected surface, which in Core HR is
     * `--accent-soft` with the accent itself as the text on it (the selected
     * rail item, the current section in a config nav).
     */
    accent: P.tealSoft,
    accentForeground: P.teal,
    accentLine: P.tealLine,

    /* Status fills carry white labels; every one clears AA (5.24 to 7.06:1).
     * The pill is text in the status colour on its soft fill with a 1px line,
     * never a solid block (DESIGN_SYSTEM §6). */
    success: P.green,
    successForeground: P.white,
    successMuted: P.greenSoft,
    successLine: P.greenLine,
    warning: P.amber,
    warningForeground: P.white,
    warningMuted: P.amberSoft,
    warningLine: P.amberLine,
    destructive: P.red,
    destructiveForeground: P.white,
    destructiveMuted: P.redSoft,
    destructiveLine: P.redLine,
    info: P.indigo,
    infoForeground: P.white,
    infoMuted: P.indigoSoft,
    infoLine: P.indigoLine,

    neutral: P.ink3,
    neutralForeground: P.white,
    neutralMuted: P.surface2,

    border: P.line,
    borderStrong: P.line2,
    input: P.field,
    ring: P.teal,

    /**
     * The one token that is the SAME in both themes. `--ink` means
     * "near-black", not "the strongest text colour": it paints things that are
     * deliberately dark whatever the theme, such as a modal scrim and the
     * roadmap band on the landing page. When it once flipped, both turned
     * into white washes. If you want the strongest text colour, that is
     * `--foreground`.
     */
    ink: P.ink,
  },

  dark: {
    background: P.dGround,
    foreground: P.dInk,
    foregroundSecondary: P.dInk2,
    card: P.dSurface,
    cardForeground: P.dInk,
    popover: P.dSurface,
    popoverForeground: P.dInk,
    surface3: P.dSurface3,

    primary: P.dTeal,
    primaryForeground: P.dTealInk,
    brand: P.sky400,
    brandForeground: P.nearBlack,
    brandStrong: P.sky400,

    secondary: P.dSurface2,
    secondaryForeground: P.dInk,
    muted: P.dSurface2,
    mutedForeground: P.dInk3,
    accent: P.dTealSoft,
    accentForeground: P.dTeal,
    accentLine: P.dTealLine,

    success: P.dGreen,
    successForeground: P.dGround,
    successMuted: P.dGreenSoft,
    successLine: P.dGreenLine,
    warning: P.dAmber,
    warningForeground: P.dGround,
    warningMuted: P.dAmberSoft,
    warningLine: P.dAmberLine,
    destructive: P.dRed,
    destructiveForeground: P.dGround,
    destructiveMuted: P.dRedSoft,
    destructiveLine: P.dRedLine,
    info: P.dIndigo,
    infoForeground: P.dGround,
    infoMuted: P.dIndigoSoft,
    infoLine: P.dIndigoLine,

    neutral: P.dInk3,
    neutralForeground: P.dGround,
    neutralMuted: P.dSurface2,

    /* Opaque, never `white / 12%`: a translucent border composites
     * differently over the page and over a card, so one of the two is always
     * wrong and nobody can see which. */
    border: P.dLine,
    borderStrong: P.dLine2,
    input: P.dField,
    ring: P.dTeal,
    ink: P.ink,
  },
};

/**
 * Shadows, per theme. Core HR uses a border AND a soft shadow on cards; the
 * dark values are heavier because a light shadow on a near-black ground is
 * invisible. The border is what carries the edge in dark, the shadow only
 * adds depth, so nothing depends on a shadow being seen.
 */
export const SHADOW: Record<ThemeName, { card: string; overlay: string }> = {
  light: {
    card: "0 1px 2px rgba(19,33,42,.07), 0 1px 3px rgba(19,33,42,.05)",
    overlay: "0 12px 34px rgba(19,33,42,.18)",
  },
  dark: {
    card: "0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.3)",
    overlay: "0 12px 34px rgba(0,0,0,.55)",
  },
};

/* ── Scales ──────────────────────────────────────────────────────────────────
 *
 * Sizes are authored in px because px is the only unit all three platforms
 * agree on. The CSS generator divides by 16 to emit rem; iOS reads the number
 * as pt and Android as dp/sp, both 1:1 with a CSS px at 1×. Native multiplies
 * type sizes by the OS font-scale setting rather than treating them as final.
 */

/** 4px base scale (DESIGN_SYSTEM §5). Nothing off-scale, ever. */
export const SPACE = {
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const;

/** The prototype's `--r`. sm and xl land on its `--r-sm` (≈5) and `--r-lg` (12). */
export const RADIUS_BASE = 8;

export const RADIUS = {
  sm: RADIUS_BASE - 4,
  md: RADIUS_BASE - 2,
  lg: RADIUS_BASE,
  xl: RADIUS_BASE + 4,
  "2xl": RADIUS_BASE + 8,
} as const;

/**
 * Type scale, from the Core HR prototype (DESIGN_SYSTEM §4). IBM Plex Sans for
 * everything, IBM Plex Mono for employee codes, dates, reference numbers and
 * numeric columns.
 *
 * `minInputSize: 16` is not a style choice and outranks the prototype's
 * 13.5px fields: below 16px iOS Safari zooms the viewport when an input takes
 * focus, which throws a form sideways mid-typing. Fields are 16px under the
 * `app` container's phone width and the prototype's size above it.
 */
export const TYPE = {
  fontSans: "IBM Plex Sans",
  fontMono: "IBM Plex Mono",
  minInputSize: 16,
  roles: {
    pageTitle: { size: 20, lineHeight: 26, weight: 600, family: "sans", tracking: -0.02 },
    cardTitle: { size: 14, lineHeight: 20, weight: 600, family: "sans", tracking: -0.01 },
    body: { size: 14, lineHeight: 21, weight: 400, family: "sans", tracking: 0 },
    tableCell: { size: 13, lineHeight: 19, weight: 400, family: "sans", tracking: 0 },
    tableHeader: { size: 10.5, lineHeight: 14, weight: 600, family: "sans", tracking: 0.07 },
    eyebrow: { size: 10, lineHeight: 14, weight: 600, family: "sans", tracking: 0.11 },
    /** Balances and day counts. `tabular-nums` is mandatory. */
    stat: { size: 27, lineHeight: 30, weight: 600, family: "sans", tracking: -0.03 },
    caption: { size: 11.5, lineHeight: 16, weight: 400, family: "sans", tracking: 0 },
    code: { size: 12, lineHeight: 17, weight: 400, family: "mono", tracking: 0 },
    /** The module name in the top bar. */
    barTitle: { size: 15, lineHeight: 20, weight: 600, family: "sans", tracking: -0.01 },
    /** Tab, rail item, menu item. */
    nav: { size: 13.5, lineHeight: 20, weight: 500, family: "sans", tracking: 0 },
  },
} as const;

/**
 * The smallest a control may be and still be reliably hittable with a thumb.
 * 48px is the floor on touch, and the number Android and iOS both publish.
 */
export const MIN_TOUCH_TARGET = 48;

/**
 * How many destinations fit on the native mobile tab bar before the rest
 * collapse into "More". iOS caps a `UITabBar` at five; the Core HR Mobile
 * design uses exactly five (Home, Leave, Attendance, Approvals, Me).
 */
export const MAX_VISIBLE_TABS = 5;

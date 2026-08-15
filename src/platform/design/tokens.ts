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
 * They lived in the stylesheet until 4 Aug 2026, which was correct while the
 * web was the only consumer. It stopped being correct the moment a native app
 * became the plan: a CSS custom property cannot be imported by React Native,
 * so the palette would have been retyped into a second file, and two
 * hand-maintained palettes drift within about a fortnight. Every fix after
 * that is applied twice or — much more likely — once.
 *
 * Authoring here and generating the CSS inverts that. The web gets the same
 * stylesheet it always had; Expo imports `SEMANTIC.dark` and calls
 * `oklchToHex` on it; both are the same numbers by construction rather than by
 * discipline.
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
 * ── the direction: Nocturne
 *
 * Chosen 4 Aug 2026 for the employee app, with the console staying light (see
 * `resolveTheme` in ./theme.ts for which surface gets which, and why).
 *
 * Nocturne is dark-FIRST rather than dark-mode-second, on an observation about
 * this specific product: leave gets checked late at night, in bed, on a phone.
 * That premise produces four decisions that are otherwise arbitrary —
 *
 *   · Tighter radius (0.5rem, from 0.75rem). Dense status lists read better
 *     with less rounding; a soft radius reads as "marketing" at this scale.
 *   · Status colours desaturated on dark. A saturated green at full chroma
 *     glares against a near-black surface and is genuinely unpleasant at
 *     night — the dark values sit ~20% lower in chroma than their light twins.
 *   · Elevation by border, never by shadow. A shadow on a near-black surface
 *     is invisible, so a shadow-only affordance simply does not exist for
 *     these users. Dark borders are solid values rather than `white / 12%`
 *     for the same reason: a translucent border over a card and over the page
 *     are two different colours, and only one of them was checked.
 *   · Cool-biased neutrals. A pure grey next to sky blue reads as unconsidered;
 *     these carry a slight blue bias so the neutral looks chosen.
 *
 * `--primary` is deliberately the same hue in both themes. A direction that
 * repaints the brand forces a brand decision before a visual one and drags the
 * marketing site along with it. Dark lifts the LIGHTNESS only, because sky
 * blue at its light-theme lightness does not reach AA on a near-black ground —
 * that is a contrast fix, not a colour change.
 */

import type { Oklch } from "./color";

export type ThemeName = "light" | "dark";

/* ── Tier 1 · Primitives ─────────────────────────────────────────────────────
 *
 * Named for appearance. **Never referenced by a component** — if you find
 * yourself importing one of these outside this file, the thing you want is a
 * semantic token that does not exist yet. Add it below instead.
 */

/*
 * ── the brand values are the PUBLISHED hexes, converted exactly
 *
 * `--primary` was `oklch(0.71 0.15 231)` from Phase 0, described everywhere as
 * "sky blue #0EA5E9". It is not #0EA5E9 and never was: that coordinate is
 * outside the sRGB gamut, so every browser clipped it and painted `#00b0ed` —
 * a colour nobody chose, on every button and link in the product, for months.
 * Nothing caught it because the value LOOKS like a faithful transcription and
 * the result looks like a blue.
 *
 * These are the real conversions of the four published hexes. `oklchToHex`
 * round-trips each one back to the exact byte values, and the gamut assertion
 * in tokens.test.ts is what stops the class of mistake rather than this one
 * instance of it.
 */

const P = {
  white: { l: 1, c: 0, h: 0 },

  /* Cool-biased neutrals. Hue 250 sits beside the brand blue, so the greys read
   * as related to it rather than merely adjacent — a pure grey next to sky blue
   * looks unconsidered. */
  ink900: { l: 0.15, c: 0.012, h: 250 },
  ink850: { l: 0.19, c: 0.014, h: 250 },
  ink800: { l: 0.21, c: 0.014, h: 250 },
  ink750: { l: 0.24, c: 0.014, h: 250 },
  ink700: { l: 0.27, c: 0.016, h: 250 },
  ink600: { l: 0.32, c: 0.016, h: 250 },
  ink500: { l: 0.52, c: 0.02, h: 250 },
  grey600: { l: 0.46, c: 0.02, h: 250 },
  grey500: { l: 0.665, c: 0.02, h: 250 },
  grey400: { l: 0.72, c: 0.018, h: 250 },
  grey200: { l: 0.91, c: 0.006, h: 250 },
  grey100: { l: 0.96, c: 0.005, h: 250 },
  grey50: { l: 0.98, c: 0.004, h: 250 },
  paper: { l: 1, c: 0, h: 0 },

  /** Sky blue `#0EA5E9` — the authoritative brand value, exactly. */
  sky500: { l: 0.6847, c: 0.1479, h: 237.32 },
  /** The same hue lifted for AA on a near-black ground. A contrast fix, not a
   *  colour change: the hue is identical and the test asserts it stays so. */
  sky400: { l: 0.79, c: 0.118, h: 237.32 },
  /** Dark enough to be a visible focus ring on white (WCAG 1.4.11). */
  sky700: { l: 0.55, c: 0.115, h: 237.32 },
  /**
   * Dark enough to be AA BODY TEXT on every light surface, which is a stricter
   * bar than the focus ring above: 1.4.11 asks 3:1 of a non-text boundary,
   * 1.4.3 asks 4.5:1 of text. sky700 clears paper (4.76) and the composited
   * `bg-secondary/40` band (4.56) but not `secondary` itself (4.24), and a
   * token that is safe on three surfaces and not the fourth is a token
   * somebody will eventually put on the fourth.
   *
   * L 0.53 is the first step down that clears all of them — paper 5.18,
   * card 5.18, secondary 4.62 — and the last one still inside sRGB at this
   * chroma. L 0.52 measures better and cannot be displayed, which the gamut
   * assertion in tokens.test.ts would have caught.
   */
  sky750: { l: 0.53, c: 0.115, h: 237.32 },
  sky100: { l: 0.95, c: 0.025, h: 237.32 },
  sky950: { l: 0.28, c: 0.058, h: 237.32 },

  /* Status. Light values are the published hexes; dark values are the same hues
   * with chroma pulled back, because a full-chroma green on a near-black screen
   * at midnight glares. The tinted fills sit at the top of the lightness range
   * and are chroma-capped by the sRGB gamut, not by taste. */

  /** `#22C55E` */
  green500: { l: 0.7227, c: 0.192, h: 149.58 },
  green400: { l: 0.76, c: 0.13, h: 149.58 },
  green100: { l: 0.94, c: 0.05, h: 149.58 },
  green900: { l: 0.27, c: 0.05, h: 149.58 },

  /** `#F59E0B` */
  amber500: { l: 0.7686, c: 0.1647, h: 70.08 },
  amber400: { l: 0.81, c: 0.13, h: 70.08 },
  amber100: { l: 0.95, c: 0.034, h: 70.08 },
  amber900: { l: 0.29, c: 0.05, h: 70.08 },

  /** `#EF4444` */
  red500: { l: 0.6368, c: 0.2078, h: 25.33 },
  red400: { l: 0.71, c: 0.16, h: 25.33 },
  red100: { l: 0.94, c: 0.028, h: 25.33 },
  red900: { l: 0.27, c: 0.07, h: 25.33 },
} as const satisfies Record<string, Oklch>;

/* ── Tier 2 · Semantic ───────────────────────────────────────────────────────
 *
 * The contract. Every key here becomes a CSS custom property of the same name
 * (camelCase → kebab-case) and a React Native colour of the same name.
 */

export type SemanticToken =
  | "background"
  | "foreground"
  | "card"
  | "cardForeground"
  | "popover"
  | "popoverForeground"
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
  | "success"
  | "successForeground"
  | "successMuted"
  | "warning"
  | "warningForeground"
  | "warningMuted"
  | "destructive"
  | "destructiveForeground"
  | "destructiveMuted"
  | "info"
  | "infoForeground"
  | "infoMuted"
  | "neutral"
  | "neutralForeground"
  | "neutralMuted"
  | "border"
  | "input"
  | "ring"
  | "ink";

export const SEMANTIC: Record<ThemeName, Record<SemanticToken, Oklch>> = {
  /**
   * Light. What the console always renders in, and what anyone who explicitly
   * chooses light gets. `primary` here is the authored brand value, untouched
   * from before this direction was adopted.
   */
  light: {
    background: P.paper,
    foreground: P.ink900,
    card: P.paper,
    cardForeground: P.ink900,
    popover: P.paper,
    popoverForeground: P.ink900,

    primary: P.sky500,
    /*
     * Dark, not white — and this is a correction, not a preference.
     *
     * The design system specified white on `--primary`, which measures 2.77:1.
     * AA for body text is 4.5:1, so every primary button, every link on a
     * filled surface and every active nav item was well under half the
     * required contrast. Near-black on the same blue is 7.10:1.
     *
     * The alternative was darkening the blue until white passed, which needs
     * roughly L≤0.55 — a different, oceanic blue. That would have been a brand
     * change made silently inside a theme file to satisfy a contrast rule. The
     * published brand colour is preserved exactly; only the label on top of it
     * moved. The same rule is applied to every status fill below.
     */
    primaryForeground: P.ink900,
    brand: P.sky500,
    brandForeground: P.ink900,
    /*
     * The brand blue when it is TEXT rather than a fill.
     *
     * `primary` is #0ea5e9, the published brand colour, and the note above
     * explains why it is preserved exactly. As a *fill* it is correct and
     * `primaryForeground` was darkened to sit on it. As *text on a light
     * ground* it measures 2.77:1 on paper and 2.65:1 on a `bg-secondary/40`
     * band — barely half of AA's 4.5:1 — and the landing page had been using
     * it that way for every section eyebrow since the page was written.
     *
     * Nothing caught it because `["primary", "background"]` was never in
     * TEXT_PAIRS: the suite checks the label on a primary fill, which is the
     * opposite direction. It is in TEXT_PAIRS now, for this token.
     *
     * sky750 is the same hue (237.32) at L 0.53 — 5.18:1 on paper, 5.18:1 on
     * a card, 4.62:1 on `secondary`. sky700 was tried first and rejected: it
     * passes the COMPOSITED `bg-secondary/40` band at 4.56:1 but fails
     * `secondary` itself at 4.24:1, and the assertion added alongside this is
     * against the token rather than the composite precisely so the stricter of
     * the two is the one that has to hold.
     *
     * NOT for eyebrows on `bg-ink`: this is 4.13:1 or worse on ink. Those keep
     * `primary`, which is 7.10:1 there. Two grounds, two tokens — the
     * alternative is one token that is wrong on one of them.
     */
    brandStrong: P.sky750,

    secondary: P.grey100,
    secondaryForeground: P.ink900,
    muted: P.grey100,
    mutedForeground: P.grey600,
    accent: P.sky100,
    accentForeground: P.ink900,

    success: P.green500,
    successForeground: P.ink900,
    successMuted: P.green100,
    warning: P.amber500,
    warningForeground: P.ink900,
    warningMuted: P.amber100,
    destructive: P.red500,
    destructiveForeground: P.ink900,
    destructiveMuted: P.red100,

    /*
     * `--info` IS the brand blue (DESIGN_SYSTEM §3). Not laziness — it is what
     * makes the deliberate inconsistency in the leave calendar legible: an
     * approved request shows a GREEN badge in a list but a BLUE cell in the
     * calendar, because green on a calendar reads as "free to book" while blue
     * reads as "booked". Two tokens, two meanings, one hue.
     */
    info: P.sky500,
    infoForeground: P.ink900,
    infoMuted: P.sky100,

    neutral: P.grey600,
    neutralForeground: P.paper,
    neutralMuted: P.grey50,

    border: P.grey200,
    /* Darker than `--border` on purpose. WCAG 1.4.11 wants 3:1 on anything you
     * have to find and click; the old value was 1.31:1, which is a hairline
     * that vanishes on a phone in daylight. Dividers stay soft — they are
     * decorative and holding them to 3:1 makes every table look like a
     * spreadsheet. */
    input: P.grey500,
    /* The focus ring must clear 3:1 against the page it sits on. The brand blue
     * itself is 2.48:1 on white, so keyboard focus was effectively invisible in
     * the light theme. Same hue, darker. */
    ring: P.sky700,

    /**
     * The one token that is the SAME in both themes, and the only one allowed
     * to be. `--ink` means "near-black", not "the strongest text colour" — it
     * paints things that are deliberately dark whatever the theme: the
     * roadmap band on the landing page, and the scrim behind a mobile menu.
     *
     * It did not flip before 4 Aug 2026 (the dark block simply never declared
     * it) and briefly did, which turned the roadmap section into white text on
     * a near-white ground and the menu scrim into a white wash that lightened
     * the page it was supposed to dim. Both were invisible in code review and
     * obvious the moment anyone looked at the screen.
     *
     * If you want "the strongest text colour", that is `--foreground`.
     */
    ink: P.ink900,
  },

  /**
   * Nocturne. The employee app's default.
   *
   * Note what is NOT here: a translucent border. `white / 12%` composites
   * differently over the page and over a card, so one of the two was always
   * wrong and nobody could see which. These are opaque values picked against
   * the surface they sit on.
   */
  dark: {
    background: P.ink900,
    foreground: P.grey50,
    card: P.ink850,
    cardForeground: P.grey50,
    popover: P.ink800,
    popoverForeground: P.grey50,

    primary: P.sky400,
    primaryForeground: P.ink900,
    brand: P.sky400,
    brandForeground: P.ink900,
    /*
     * Identical to `primary` here, and deliberately so. On a dark ground the
     * brand blue is already 10.35:1 on the page and 9.75:1 on the band — dark
     * mode never had this defect. The token exists so the light theme can
     * differ; darkening it here would make the eyebrow recede into the page
     * to fix a problem this theme does not have.
     */
    brandStrong: P.sky400,

    secondary: P.ink750,
    secondaryForeground: P.grey50,
    muted: P.ink750,
    mutedForeground: P.grey400,
    accent: P.ink700,
    accentForeground: P.grey50,

    success: P.green400,
    successForeground: P.ink900,
    successMuted: P.green900,
    warning: P.amber400,
    warningForeground: P.ink900,
    warningMuted: P.amber900,
    destructive: P.red400,
    destructiveForeground: P.ink900,
    destructiveMuted: P.red900,
    info: P.sky400,
    infoForeground: P.ink900,
    infoMuted: P.sky950,
    neutral: P.grey400,
    neutralForeground: P.ink900,
    neutralMuted: P.ink700,

    border: P.ink600,
    input: P.ink500,
    ring: P.sky400,
    /* Identical to the light theme's — see the note on the light side. */
    ink: P.ink900,
  },
};

/* ── Scales ──────────────────────────────────────────────────────────────────
 *
 * Sizes are authored in px because px is the only unit all three platforms
 * agree on. The CSS generator divides by 16 to emit rem; iOS reads the number
 * as pt and Android as dp/sp, both of which are 1:1 with a CSS px at 1×.
 *
 * A native app must scale text with the OS accessibility setting — iOS Dynamic
 * Type and Android font scaling are accessibility features, and an app that
 * ignores them is a real App Store review risk. So `TYPE` gives a base size and
 * a ratio per role rather than a frozen pt value: native multiplies by the
 * system scale factor, the web gets rem and inherits the browser's root size.
 * Neither platform is handed a number it must not change.
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

/**
 * Nocturne tightens this from 12px. Everything else derives, so this is the
 * one number to change if the direction is ever reconsidered.
 */
export const RADIUS_BASE = 8;

export const RADIUS = {
  sm: RADIUS_BASE - 4,
  md: RADIUS_BASE - 2,
  lg: RADIUS_BASE,
  xl: RADIUS_BASE + 4,
  "2xl": RADIUS_BASE + 8,
} as const;

/**
 * Type scale. `size` is at the OS default; native multiplies it by the user's
 * font-scale setting rather than treating it as final.
 *
 * `minInputSize: 16` is not a style choice — below 16px iOS Safari zooms the
 * viewport when an input takes focus, which on the apply-leave form throws the
 * page sideways mid-typing.
 */
export const TYPE = {
  fontDisplay: "Space Grotesk",
  fontBody: "Inter",
  minInputSize: 16,
  roles: {
    display: { size: 48, lineHeight: 52, weight: 700, family: "display" },
    h1: { size: 36, lineHeight: 40, weight: 700, family: "display" },
    h2: { size: 30, lineHeight: 36, weight: 700, family: "display" },
    h3: { size: 24, lineHeight: 32, weight: 600, family: "display" },
    h4: { size: 20, lineHeight: 28, weight: 600, family: "display" },
    body: { size: 16, lineHeight: 24, weight: 400, family: "body" },
    bodySmall: { size: 14, lineHeight: 20, weight: 400, family: "body" },
    caption: { size: 12, lineHeight: 16, weight: 400, family: "body" },
    /** Balances and day counts. `tabular-nums` is mandatory — see §4. */
    metric: { size: 30, lineHeight: 36, weight: 700, family: "display" },
  },
} as const;

/**
 * The smallest a control may be and still be reliably hittable with a thumb.
 * 48px is the floor on mobile in DESIGN_SYSTEM §6 and the same number Android
 * and iOS both publish, so it carries to native unchanged.
 */
export const MIN_TOUCH_TARGET = 48;

/**
 * How many destinations fit on the mobile tab bar before the rest collapse
 * into "More".
 *
 * Five is not a preference. iOS caps a `UITabBar` at five items and moves the
 * remainder into a system "More" tab; matching that here means the web and the
 * native app collapse at the same point, so a person who uses both is not
 * learning two different navigations. Four visible plus "More" — because
 * "More" occupies one of the five slots.
 */
export const MAX_VISIBLE_TABS = 5;

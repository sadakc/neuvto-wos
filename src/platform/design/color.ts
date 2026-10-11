/**
 * Platform · Design · Colour conversion
 *
 * Tokens are authored in OKLCH because it is perceptually uniform — lightening
 * a colour by 10% looks like 10% to the eye at every hue, which is what makes
 * "the dark theme is the light theme with the lightness flipped" a defensible
 * statement rather than a hopeful one.
 *
 * The web consumes OKLCH directly; every browser we support parses it. Two
 * other consumers cannot:
 *
 *   1. React Native's colour parser handles hex, rgb() and hsl(). It does not
 *      handle oklch(), and it fails by throwing at runtime rather than by
 *      falling back — so shipping OKLCH to a native build is a crash, not a
 *      wrong colour.
 *   2. The contrast test in tokens.test.ts, which needs sRGB to compute a
 *      WCAG ratio.
 *
 * So the conversion lives here, in about forty lines of well-specified maths,
 * rather than in a dependency. This is Björn Ottosson's published OKLab matrix
 * — the same one browsers implement — so a token renders identically on web
 * and native rather than merely similarly.
 */

export type Oklch = {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma. 0 is grey; roughly 0.37 is the most saturated sRGB can hold. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
  /** Alpha, 0–1. Defaults to opaque. */
  alpha?: number;
};

/** The CSS value a browser consumes. */
export function oklchToCss({ l, c, h, alpha = 1 }: Oklch): string {
  const base = `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`;
  return alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${round(alpha * 100, 2)}%)`;
}

/**
 * sRGB channels in 0–255, gamut-clipped.
 *
 * Clipping matters and is worth stating plainly: a few OKLCH values are outside
 * what sRGB can represent, and this clamps them per channel rather than
 * gamut-mapping toward the achromatic axis. The consequence is that an
 * out-of-gamut colour comes back slightly desaturated AND slightly hue-shifted,
 * so it would differ between web and native. The contrast test asserts every
 * token is in gamut, which is what makes the clamp unreachable in practice
 * rather than merely unlikely.
 */
export function oklchToRgb({ l, c, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  // OKLab → LMS (cube roots), then cubed back to linear LMS.
  const lCbrt = l + 0.3963377774 * a + 0.2158037573 * b;
  const mCbrt = l - 0.1055613458 * a - 0.0638541728 * b;
  const sCbrt = l - 0.0894841775 * a - 1.291485548 * b;

  const lLin = lCbrt ** 3;
  const mLin = mCbrt ** 3;
  const sLin = sCbrt ** 3;

  // Linear LMS → linear sRGB.
  const r = 4.0767416621 * lLin - 3.3077115913 * mLin + 0.2309699292 * sLin;
  const g = -1.2684380046 * lLin + 2.6097574011 * mLin - 0.3413193965 * sLin;
  const bl = -0.0041960863 * lLin - 0.7034186147 * mLin + 1.707614701 * sLin;

  return [encodeSrgb(r), encodeSrgb(g), encodeSrgb(bl)];
}

/**
 * `#RRGGBB` → OKLCH. The exact inverse of `oklchToRgb`, using the same
 * published matrices run backwards.
 *
 * Exists because a design arrives in hex. The Core HR palette (11 Oct 2026) is
 * specified as hex values copied from its prototype, and retyping each one as a
 * hand-rounded OKLCH coordinate is how `--primary` once became a colour nobody
 * chose. Converting in code means the token IS the published value, and the
 * round-trip assertion in color.test.ts proves it.
 */
export function hexToOklch(hex: string): Oklch {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`hexToOklch: "${hex}" is not #RRGGBB`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => decodeSrgb(parseInt(x, 16) / 255));

  // Linear sRGB → LMS → cube roots → OKLab.
  const lLin = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const mLin = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const sLin = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const [l_, m_, s_] = [lLin, mLin, sLin].map(Math.cbrt);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  // An achromatic colour has no meaningful hue; 0 keeps the value stable.
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function decodeSrgb(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB`. What React Native, Android `colors.xml` and iOS colour sets want. */
export function oklchToHex(value: Oklch): string {
  const [r, g, b] = oklchToRgb(value);
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * True when a colour survives the trip to sRGB unchanged — i.e. no channel
 * needed clipping. Asserted for every token so the web and native palettes
 * cannot silently diverge.
 */
export function isInSrgbGamut({ l, c, h }: Oklch): boolean {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const lLin = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mLin = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sLin = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const channels = [
    4.0767416621 * lLin - 3.3077115913 * mLin + 0.2309699292 * sLin,
    -1.2684380046 * lLin + 2.6097574011 * mLin - 0.3413193965 * sLin,
    -0.0041960863 * lLin - 0.7034186147 * mLin + 1.707614701 * sLin,
  ];
  // A hair of tolerance: the matrix is floating point, and a channel landing at
  // 1.0000001 is in gamut by any meaning that matters.
  return channels.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Used by the token test rather than by any component. Nobody should be
 * computing contrast at runtime — the point is that the palette is proven
 * once, in CI, and then trusted.
 */
export function relativeLuminance(value: Oklch): number {
  const [r, g, b] = oklchToRgb(value).map((n) => {
    const channel = n / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function encodeSrgb(linear: number): number {
  const gamma =
    linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.max(linear, 0) ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, gamma * 255));
}

function round(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

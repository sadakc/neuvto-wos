#!/usr/bin/env python3
"""
Build public/social-card.png — the picture attached to neuvto.com everywhere it
is shared.

WHY THIS EXISTS

Until 8 Aug 2026 `og:image` pointed at

    https://pub-bb2e…r2.dev/…/id-preview-b316bebf--…lovable.app-1784785091719.png

a Lovable build preview, on Lovable's R2 bucket, with `id-preview` and
`lovable.app` in the filename. Live and serving — so every share of the company
on LinkedIn or WhatsApp fetched its picture from infrastructure Neuvto does not
own and cannot keep. The same reason the deploy pipeline moved.

WHY A GENERATOR RATHER THAN A CHECKED-IN PNG SOMEBODY EXPORTED

The colours come from `src/platform/design/tokens.ts`, which is the authored
source for every colour in the product — editing `styles.css` by hand is
silently reverted, and a hand-exported card would drift from the brand the same
way. The oklch → sRGB conversion below is the same one the token pipeline does,
so the card is the brand rather than a close match to it.

    python3 scripts/generate-social-card.py

Needs Pillow. Run it when the mark or the brand colours change; the PNG it
writes is committed, so nothing in CI or the build depends on Python.
"""

import pathlib
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is not installed:  python3 -m pip install Pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "social-card.png"
MARK = ROOT / "brand" / "neuvto-mark-source.png"
FONT_BOLD = ROOT / "brand" / "fonts" / "SpaceGrotesk-Bold.ttf"
FONT_MED = ROOT / "brand" / "fonts" / "SpaceGrotesk-Medium.ttf"

# 1.91:1, which is what `twitter:card = summary_large_image` and every Open
# Graph consumer crops to. A square image here is letterboxed or centre-cropped,
# and neither is a decision anybody made.
W, H = 1200, 630

# Straight from src/platform/design/tokens.ts. Named, not eyeballed.
INK = (0.15, 0.012, 250)  # --ink / dark background
PRIMARY = (0.6847, 0.1479, 237.32)  # --primary
PAPER = (1.0, 0.0, 0.0)  # --background, light


def oklch_to_srgb(l: float, c: float, h_deg: float) -> tuple[int, int, int]:
    """oklch → 8-bit sRGB. The same path the token pipeline takes."""
    import math

    h = math.radians(h_deg)
    a, b = c * math.cos(h), c * math.sin(h)

    l_ = l + 0.3963377774 * a + 0.2158037573 * b
    m_ = l - 0.1055613458 * a - 0.0638541728 * b
    s_ = l - 0.0894841775 * a - 1.2914855480 * b
    L, M, S = l_**3, m_**3, s_**3

    r = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S
    g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S
    bl = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S

    def gamma(u: float) -> int:
        u = max(0.0, min(1.0, u))
        u = 1.055 * (u ** (1 / 2.4)) - 0.055 if u > 0.0031308 else 12.92 * u
        return round(u * 255)

    return gamma(r), gamma(g), gamma(bl)


def main() -> None:
    ink = oklch_to_srgb(*INK)
    primary = oklch_to_srgb(*PRIMARY)
    paper = oklch_to_srgb(*PAPER)

    card = Image.new("RGB", (W, H), ink)
    draw = ImageDraw.Draw(card)

    # A single hairline in the brand blue along the top. The dark ground is the
    # console's own signal (design/theme.ts) and the card should read as the
    # product, not as a poster.
    draw.rectangle([0, 0, W, 6], fill=primary)

    if MARK.exists():
        mark = Image.open(MARK).convert("RGBA")
        size = 148
        mark.thumbnail((size, size), Image.LANCZOS)
        card.paste(mark, (96, 150), mark)

    def font(path: pathlib.Path, size: int):
        if path.exists():
            return ImageFont.truetype(str(path), size)
        # Space Grotesk is fetched from Google Fonts at runtime by the site and
        # is committed under brand/fonts for this script. If it is ever missing,
        # say so rather than silently shipping a card in a different typeface.
        print(f"  ! {path.name} missing — falling back to a system face", file=sys.stderr)
        return ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", size)

    wordmark = font(FONT_BOLD, 92)
    tagline = font(FONT_MED, 38)
    footer = font(FONT_MED, 26)

    # "neuvto." — lowercase with the dot in the brand blue, exactly as
    # NeuvtoLockup renders it in the product.
    x, y = 96, 330
    draw.text((x, y), "neuvto", font=wordmark, fill=paper)
    x += draw.textlength("neuvto", font=wordmark)
    draw.text((x, y), ".", font=wordmark, fill=primary)

    draw.text((96, 452), "The Workforce Operating System", font=tagline, fill=(154, 163, 178))
    draw.text(
        (96, 524),
        "Leave management today · attendance, payroll and performance next",
        font=footer,
        fill=(108, 118, 134),
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    card.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}  {W}x{H}  {OUT.stat().st_size:,} bytes")
    print(f"  ink {ink}  primary {primary}")


if __name__ == "__main__":
    main()

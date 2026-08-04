# NEUVTO WOS — Translating the design system to native

**Status:** Active · **Decided:** 4 Aug 2026
**Read with:** `NEUVTO_DESIGN_SYSTEM.md`, which this does not repeat.

Why this exists: the plan is a Play Store and App Store app. Nothing here is built yet.
What the web build has already done is stop making that harder — the palette, scales and
the rules that govern them are now in a TypeScript file a native build can import, instead
of in a stylesheet only a browser can read.

---

## 1. The decision: React Native / Expo

**Chosen 4 Aug 2026 by Sada.** The token file is importable from a React Native build, so
the palette, the type scale, the spacing scale and the touch-target floor are shared
rather than transcribed.

The trade, stated plainly so nobody re-opens it without new information:

|                                         | React Native / Expo                  | SwiftUI + Compose                                   |
| --------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Design tokens                           | **imported** from `design/tokens.ts` | regenerated per platform, drift is a matter of time |
| Supabase client, contracts, Zod schemas | reused directly                      | rewritten twice                                     |
| Feel                                    | very good, not indistinguishable     | native                                              |
| Cost of a second module                 | one implementation                   | three                                               |

The deciding factor was not feel — it was that a Leave module built three times gets fixed
once and stays broken twice. Revisit only if a specific screen proves impossible, and
revisit for that screen, not for the architecture.

---

## 2. What already carries over

These are properties of the current code, not aspirations.

| Thing                          | Where it lives                                   | How native consumes it                                     |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| Colour palette, 2 themes       | `SEMANTIC` in `design/tokens.ts`                 | `oklchToHex(SEMANTIC.dark.primary)` → `#68c6fe`            |
| Spacing scale                  | `SPACE` — 4px base                               | numbers are already density-independent pixels             |
| Radius scale                   | `RADIUS`, from `RADIUS_BASE`                     | pt / dp, 1:1                                               |
| Type scale                     | `TYPE.roles` — size, line height, weight, family | multiply `size` by the OS font scale (see §3)              |
| Touch target floor             | `MIN_TOUCH_TARGET = 48`                          | the same number Apple and Google both publish              |
| Tab-bar cap                    | `MAX_VISIBLE_TABS = 5`                           | `UITabBar`'s own limit (see §4)                            |
| Error strings                  | the database, via `AppError`                     | unchanged — messages come from Postgres, not the client    |
| Empty / loading / error states | each screen component                            | the states exist and are named; only the rendering differs |

`oklchToHex` is exact for every token — the palette is asserted in-gamut, so no colour
gets clipped on the way to sRGB and the two platforms cannot disagree.

---

## 3. Type must scale with the OS

**Do not ship fixed point sizes.** iOS Dynamic Type and Android font scaling are
accessibility features; an app that ignores them is a real App Store review risk and, more
to the point, unusable for the people who rely on them.

`TYPE.roles.body.size` is 16 **at the OS default**, not finally. Native multiplies by the
system scale factor. The web equivalent is already correct — `rem` inherits the browser's
root size — which is why the scale is stored in px and converted at the edge rather than
baked into either platform's units.

`TYPE.minInputSize` (16) has a second, unrelated reason on web: below it, iOS Safari zooms
the viewport when an input takes focus, which throws the apply-leave form sideways
mid-typing.

---

## 4. What does not carry over

Worth knowing before a screen is designed around it.

**Hover states.** There is no hover on a touchscreen. Anything currently discoverable only
by hovering needs a visible affordance — check `title=` attributes especially, which are
invisible on a phone.

**Wide report tables.** The three reports scroll horizontally on the web. On a phone that
is a bad experience, and the answer is a different layout — a card per row, or a chosen
subset of columns — not a smaller font.

**CSV export.** `download` on an anchor does nothing useful on iOS. Native writes a file
and opens the system share sheet.

**The sixth navigation item.** `UITabBar` caps at five and moves the rest into its own
"More" tab. The web now collapses at exactly the same point (`splitNavItems`), so the two
navigations agree — but it means adding a seventh destination is a design decision, not an
append.

**Offline.** Not claimed anywhere today, deliberately: a cached leave balance that is
wrong is worse than no cache, because somebody books days they have already spent. A
native app makes offline expected rather than optional, and that is a product decision to
take before it is a technical one.

---

## 5. Assets

`brand/neuvto-mark-source.png` is the 1024px master. Every icon in `public/` is generated
from it, so a native icon set regenerates from the same file rather than from a resized
copy of a resized copy.

The maskable icon is worth copying rather than re-deriving: Android crops launcher icons
to a circle, squircle or rounded square depending on the device, and anything outside a
circle of 80% diameter can be cut. `public/icon-maskable-512.png` is scaled so the mark's
bounding-box **diagonal** fits that circle, on an opaque `#0A0A0A` ground — transparency
composites unpredictably.

Below 32px the mark's 3D faces lose definition; use `favicon.ico` there. This is why
`NeuvtoMark` has no size smaller than `sm`.

---

## 6. What is deliberately NOT shared

**The tenant's logo is not Neuvto's mark.** D45: a customer's workspace should look like
the customer's. `src/routes/app/route.tsx` renders their logo; an empty slot when they
have not uploaded one is correct, and falling back to Neuvto's mark would make an
unbranded workspace look like our product. A native app inherits this rule.

**The console does not go native.** `/neuvto-hq` is a desktop tool used by Neuvto staff to
provision workspaces. It has no mobile case, and giving it one widens the surface on which
D42 — platform admins never read tenant data — has to hold.

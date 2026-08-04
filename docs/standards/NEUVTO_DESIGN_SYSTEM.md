# NEUVTO WOS — Design System

**Version:** 1.0 · **Status:** Active
**Audience:** designers, engineers, and AI build tools — all three work from this file

The contract between design and code. A designer should be able to open this, look at a
screen, and know which token every colour, size, and radius came from. An engineer should
never need to invent a value.

---

## 1. The one rule

**No raw values in application code. Ever.**

```tsx
❌ <div className="bg-[#0EA5E9] text-white rounded-[12px] p-[16px]">
❌ <div style={{ color: '#333' }}>
✅ <div className="bg-primary text-primary-foreground rounded-lg p-4">
```

A hex code in a component is a bug. It won't respond to dark mode, it can't be re-themed
per tenant, and it will drift. Tenant white-labelling (`03` §Branding Service) is only
possible because every colour resolves through a variable.

**Colours are authored in `src/platform/design/tokens.ts`, not in `src/styles.css`.**
The stylesheet is generated — `bun run tokens` — and CI fails if the two disagree. Editing
the generated block appears to work and is silently reverted the next time anyone
regenerates. The TypeScript file is also what a React Native build imports, which is the
reason it, rather than the CSS, is the source of truth.

---

## 2. Token architecture — three tiers

```
Tier 1  Primitive   Raw values. Never referenced by a component.
                    --blue-500: oklch(0.71 0.15 231)

Tier 2  Semantic    Meaning, not appearance. What components use.
                    --primary: var(--blue-500)
                    --success: var(--green-500)

Tier 3  Component   Only when a component needs to deviate systematically.
                    --button-height-md: 2.5rem
```

Components consume **Tier 2 only**. Naming a token for its meaning rather than its colour
is what lets a tenant set their brand to green without every class in the codebase being
named `blue`.

Tokens are authored in `src/platform/design/tokens.ts` in **OKLCH** and generated into
`src/styles.css` as CSS custom properties, exposed to Tailwind through `@theme inline`.
OKLCH is deliberate: it's perceptually uniform, so lightening a colour by 10% looks like
10% to the eye across every hue.

`oklchToHex` in `design/color.ts` converts for consumers that cannot parse OKLCH — React
Native, iOS colour sets, Android `colors.xml`. A token is therefore the same colour on
every platform by construction rather than by transcription.

---

## 3. Colour

### Brand

| Token                  | Value                              | Use                                                              |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `--primary`            | `#0EA5E9` sky blue                 | Primary actions, links, focus rings, active nav                  |
| `--primary-foreground` | white                              | Text on primary                                                  |
| `--brand`              | = primary                          | Logo lockup, marketing surfaces                                  |
| `--secondary`          | light grey `oklch(0.97 0.005 240)` | **Secondary _button_ fill** — a surface role, not a brand colour |
| `--brand-accent`       | `#0088AA` teal                     | Optional: icon accents, second chart series                      |

> **Resolved 28 Jul 2026: `#0EA5E9` sky blue is authoritative.** `05_LANDING_PAGE.md`
> line 607 specifies `#0066CC`; that document is superseded on this point and should be
> updated. The value is set here and nowhere else — one variable, one change.

> **Do not confuse `--secondary` with "the secondary brand colour."** In shadcn's token
> vocabulary `--secondary` is a _surface_ role: the fill of a secondary button. It is a
> near-white grey and must stay that way, or every secondary button on the platform turns
> teal. Brand teal, if used, is `--brand-accent` and is reserved for accents and data
> visualisation — never for a button fill or body text (it fails contrast at `text-sm`).

### Status

Leave management is a status-driven product. Added 4 Aug 2026 — until then a status was
drawn as grey text, so approved, declined and awaiting all looked identical.

Each has a solid fill, a foreground, and a `-muted` tint for badges and calendar cells.

| Token           | Light fill      | Meaning                                 |
| --------------- | --------------- | --------------------------------------- |
| `--success`     | `#22C55E` green | Approved, sufficient balance, healthy   |
| `--warning`     | `#F59E0B` amber | Pending approval, low balance, expiring |
| `--destructive` | `#EF4444` red   | Rejected, error, over-balance           |
| `--info`        | = `--primary`   | Informational, upcoming leave           |
| `--neutral`     | grey            | Draft, cancelled, inactive              |

> **Every `-foreground` is near-black, including on red — and this replaced "white".**
> White on `#0EA5E9` measures **2.77:1**; AA for body text is 4.5:1. The same held for
> green (2.28:1) and amber (2.15:1). The published fills are preserved exactly and the
> label on top changed instead, because darkening the fills until white passed would have
> been a brand change made silently to satisfy a contrast rule.
>
> None of this is anyone's judgement now: `src/platform/design/tokens.test.ts` computes
> every pairing and fails the build under 4.5:1. Change a colour and watch it fail.

**Leave status → token. This mapping is fixed; do not improvise per screen.**

| Status             | Token         | Badge                            | Calendar cell      |
| ------------------ | ------------- | -------------------------------- | ------------------ |
| `draft`            | `neutral`     | grey outline                     | —                  |
| `pending_approval` | `warning`     | amber solid                      | amber fill         |
| `approved`         | `success`     | green solid                      | blue fill (`info`) |
| `rejected`         | `destructive` | red solid                        | —                  |
| `cancelled`        | `neutral`     | grey outline, strikethrough date | —                  |

> Deliberate inconsistency, taken from `06` §Leave Calendar: an approved leave shows a
> **green badge** in lists but a **blue cell** in the calendar. Green-on-calendar reads as
> "available to book"; blue reads as "booked". Keep it.

### Surfaces

| Token                | Light                   | Dark              | Use                                   |
| -------------------- | ----------------------- | ----------------- | ------------------------------------- |
| `--background`       | white                   | `oklch(0.12 0 0)` | Page                                  |
| `--card`             | white                   | `oklch(0.16 0 0)` | Cards, panels, modals                 |
| `--muted`            | `oklch(0.97 0.005 240)` | `oklch(0.22 0 0)` | Subtle fills, table stripes, disabled |
| `--border`           | `oklch(0.92 0.005 240)` | `white / 12%`     | All borders and dividers              |
| `--foreground`       | `oklch(0.15 0 0)`       | `oklch(0.98 0 0)` | Body text                             |
| `--muted-foreground` | `oklch(0.45 0.02 240)`  | `oklch(0.7 0 0)`  | Secondary text, captions              |

**Never** use `--border` for text or `--muted-foreground` for a border. Roles don't cross.

### Dark mode — Nocturne

Every token has a `.dark` value. Dark mode is not optional and not a later phase — a
component that only works in light mode is incomplete. Test both before calling anything done.

**Which surface gets which theme** is decided by `resolveTheme` in
`src/platform/design/theme.ts`, not by the operating system alone:

| Surface                       | Theme                     | Why                                                                         |
| ----------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `/app/*` — the employee app   | **dark**, overridable     | Leave gets checked late at night, on a phone. A toggle in the header wins.   |
| `/neuvto-hq` — the console    | **light, always**         | A platform admin must never mistake the console for a tenant workspace (D42). |
| everything else               | follows the OS            | A stranger's system preference is the only signal available.                 |

Nocturne, adopted 4 Aug 2026, is dark-*first* rather than dark-mode-second. Four decisions
follow from that premise:

- **`--radius` is 8px**, down from 12. Dense status lists read better with less rounding.
- **Status colours are desaturated on dark** (~20% less chroma). Full-chroma green glares
  against near-black at night. Asserted by test, so it cannot drift back.
- **Elevation is border-only on dark.** A shadow on a near-black surface is invisible, so
  a shadow-only affordance does not exist for these users.
- **Dark borders are opaque values, not `white / 12%`.** A translucent border composites
  differently over the page than over a card — only one of the two was ever checked.

---

## 4. Typography

| Token            | Family        | Use                        |
| ---------------- | ------------- | -------------------------- |
| `--font-display` | Space Grotesk | `h1`–`h6`, metric numerals |
| `--font-sans`    | Inter         | Everything else            |

Headings carry `letter-spacing: -0.02em`. Applied globally in `@layer base` — never re-declare.

| Role       | Class                                | Size / line height | Weight |
| ---------- | ------------------------------------ | ------------------ | ------ |
| Display    | `text-5xl`                           | 48 / 52            | 700    |
| H1         | `text-4xl`                           | 36 / 40            | 700    |
| H2         | `text-3xl`                           | 30 / 36            | 700    |
| H3         | `text-2xl`                           | 24 / 32            | 600    |
| H4         | `text-xl`                            | 20 / 28            | 600    |
| Body       | `text-base`                          | 16 / 24            | 400    |
| Body small | `text-sm`                            | 14 / 20            | 400    |
| Caption    | `text-xs`                            | 12 / 16            | 400    |
| Metric     | `text-3xl font-display tabular-nums` | 30 / 36            | 700    |

**`tabular-nums` is mandatory on every number that changes** — balances, day counts,
countdowns. Without it digits have different widths and the number visibly jitters as it
updates. This is the single most common polish failure in a dashboard.

**16px minimum for any input on mobile.** Below that, iOS Safari zooms the viewport on focus.

---

## 5. Spacing, radius, elevation

**Spacing:** 4px base scale — `1`=4 · `2`=8 · `3`=12 · `4`=16 · `6`=24 · `8`=32 · `12`=48 · `16`=64.
Nothing off-scale. No `p-[13px]`.

- Inside a card: `p-6` desktop, `p-4` mobile
- Between form fields: `space-y-4`
- Between page sections: `space-y-8`
- Related elements (label → input): `space-y-2`

**Radius** — from `RADIUS_BASE = 8` in `design/tokens.ts` (`--radius: 0.5rem`). Nocturne
tightened this from 12px; everything else derives, so it is one number to change.

| Token          | Value | Use                         |
| -------------- | ----- | --------------------------- |
| `rounded-sm`   | 4px   | Badges, chips, small inputs |
| `rounded-md`   | 6px   | Buttons, inputs             |
| `rounded-lg`   | 8px   | Cards, panels               |
| `rounded-xl`   | 12px  | Modals, sheets              |
| `rounded-full` | —     | Avatars, icon-only buttons  |

**Elevation:** borders first, shadows sparingly. `shadow-sm` for resting cards,
`shadow-md` on hover for interactive cards, `shadow-lg` for modals and popovers only.
Dark mode uses border contrast rather than shadow — shadows are nearly invisible on dark
surfaces, so a shadow-only affordance disappears.

---

## 6. Components

Built on shadcn/ui in `components/ui/`. **Those files are not hand-edited** — variants are
added through the component's own variant API so future shadcn updates don't clobber them.

### Button

| Variant       | Appearance          | Use                             |
| ------------- | ------------------- | ------------------------------- |
| `default`     | primary fill        | The one primary action per view |
| `secondary`   | muted fill          | Secondary actions               |
| `outline`     | border, transparent | Tertiary, cancel                |
| `ghost`       | no border           | Toolbar, icon actions           |
| `destructive` | red fill            | Reject, delete, cancel leave    |
| `success`     | green fill          | **Approve** — add this variant  |

| Size      | Height   | Padding | Use                          |
| --------- | -------- | ------- | ---------------------------- |
| `sm`      | 32px     | `px-3`  | Dense tables                 |
| `default` | 40px     | `px-4`  | Desktop                      |
| `lg`      | **48px** | `px-6`  | **All mobile touch targets** |

Required states: default · hover · active · focus-visible (2px `--ring` offset 2px) ·
disabled (50% opacity, `cursor-not-allowed`) · loading (spinner replaces leading icon,
label persists, button disabled).

**Never** disable a submit button without telling the user why. The apply-leave form shows
_"You requested 5 days but have only 3 available"_ — it does not silently grey out.

### Status badge

`rounded-sm px-2 py-0.5 text-xs font-medium`. Colour strictly from the §3 status mapping.
Text always accompanies colour — never colour alone (§8).

### Card

`bg-card border border-border rounded-lg p-6 shadow-sm`. Header `text-lg font-semibold`,
optional `text-sm text-muted-foreground` description, `space-y-4` body.

### Input

Height 40px desktop / 48px mobile, `rounded-md border border-input bg-background px-3`,
`text-base` on mobile. Focus: `ring-2 ring-ring ring-offset-2`. Error: `border-destructive`
plus a message in `text-sm text-destructive` below — **colour alone is never the error signal.**
Labels are always visible. Placeholder is not a label.

### Table (admin only)

Header `bg-muted text-sm font-medium`, rows `border-b border-border`, hover `bg-muted/50`,
numeric columns right-aligned with `tabular-nums`. Below `md`, tables become stacked cards —
never a horizontal scroll on mobile.

### Empty, loading, error states

Every async view needs all three. Empty states state what's missing and offer the action
("No leave requests yet" + _Apply for leave_). Loading uses skeletons matching final layout,
not a centred spinner — spinners cause layout shift when content arrives.

---

## 7. Layout and responsive

Breakpoints: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280.

**Employee views are mobile-first.** Design at 375px, enhance upward.
**Admin views are desktop-first**, degrading to tablet. Below `md`, admin tables stack.

|                | Employee                 | Admin                    |
| -------------- | ------------------------ | ------------------------ |
| Navigation     | Bottom tab bar, ≤5 items | Collapsible left sidebar |
| Primary action | Full-width or FAB        | Top-right of content     |
| Content width  | Full bleed, `px-4`       | `max-w-7xl mx-auto px-6` |

**Mobile requirements, from `06` AC3:**

- Touch targets ≥ **48×48px**, with ≥ 8px between adjacent targets
- Dashboard balance and primary CTA **above the fold at 375×667**
- Apply-leave completable in ≤ 5 taps

---

## 8. Accessibility — non-negotiable

- **Contrast ≥ 4.5:1** for body text, ≥ 3:1 for large text and UI boundaries (`05` line 680).
  Amber `--warning` fails against white — it uses dark foreground. Verify in both themes.
- **Never colour alone.** Every status badge pairs colour with text. Roughly 1 in 12 men has
  a colour vision deficiency; a red/green approve-reject distinction is invisible to them.
- Visible `focus-visible` ring on every interactive element. Never `outline: none` without
  a replacement.
- Full keyboard operability. Modals trap focus and restore it on close. `Esc` closes.
- Every input has a `<label>`. Icon-only buttons carry `aria-label`.
- Live regions (`aria-live="polite"`) announce balance changes and approval outcomes.
- Respect `prefers-reduced-motion` — transitions drop to 0ms.

---

## 9. Motion

Fast and few. `150ms ease-out` for hover and focus, `200ms ease-out` for dropdowns and
popovers, `300ms ease-in-out` for sheets and modals. Nothing over 300ms. Animate only
`transform` and `opacity` — animating layout properties causes jank on mid-range Android,
which is what your employee users will be holding.

---

## 10. Designer handoff

**Figma variables mirror these token names exactly.** `--primary` in code is `primary` in
Figma. If a designer sends a spec saying `color/primary/default`, the engineer knows without
asking. Mismatched naming is where design systems die.

Suggested Figma collections:

```
Color / Brand / primary, secondary, brand
Color / Status / success, warning, destructive, info, neutral
Color / Surface / background, card, muted, border
Color / Text / foreground, muted-foreground
Spacing / 1, 2, 3, 4, 6, 8, 12, 16
Radius / sm, md, lg, xl, full
Type / display, h1…h4, body, body-sm, caption, metric
```

Each collection needs **Light and Dark modes** — a design delivered in one theme is half a design.

### When a designer proposes something new

1. Can an existing token express it? Use that.
2. Is it a genuinely new _meaning_ (not a new shade)? Add a Tier 2 token here first, then in code.
3. Is it a one-off? Push back. One-offs are how systems rot.

**A new hex code is a change to this document, not to a component.**

### Deliverable checklist for any new screen

- [ ] Light and dark
- [ ] 375px and 1280px
- [ ] Every interactive element's states: default, hover, focus, active, disabled, loading
- [ ] Empty, loading, and error states
- [ ] Colours named by token, not hex
- [ ] Touch targets ≥ 48px on mobile
- [ ] Contrast verified in both themes

---

## 11. Build-tool rules

For Lovable's agent and any AI writing UI:

1. Never emit a hex, rgb, or arbitrary Tailwind value (`bg-[#...]`, `p-[13px]`) in `src/modules` or `src/components/shared`
2. Never hand-edit `src/components/ui/*` — extend through variants
3. Every new colour need is raised as a token here first
4. Dark mode in the same change, never a follow-up
5. Every async view ships loading, empty, and error states
6. Mobile touch targets `size="lg"` (48px)
7. Numbers that change get `tabular-nums`

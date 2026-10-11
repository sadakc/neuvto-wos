# NEUVTO WOS — Design System

**Version:** 2.0 · **Status:** Active · **Applies to:** every screen, web and native
**Audience:** designers, engineers, and AI build tools — all three work from this file

The contract between design and code. A designer should be able to open this, look at a
screen, and know which token every colour, size, and radius came from. An engineer should
never need to invent a value.

> **2.0 (11 Oct 2026): the Core HR design replaces Nocturne (D76, D77).** The reference
> implementations are two prototypes Sada published on 11 Oct 2026: **Core HR Suite**
> (88 web screens, four roles, a device preview) and **Core HR Mobile** (the native app,
> drawn twice: Apple HIG and Material 3). Every new module, Leave's redesign included,
> is built to them. Where this file and a prototype disagree, this file wins and the
> conflict is raised, not guessed. The prototypes' written spec is the Core HR bundle,
> recorded in [../product/NEUVTO_EMPLOYEE_MASTER.md](../product/NEUVTO_EMPLOYEE_MASTER.md)
> §1 for what it changed here.

---

## 1. The one rule

**No raw values in application code. Ever.**

```tsx
❌ <div className="bg-[#0f5f79] text-white rounded-[12px] p-[16px]">
❌ <div style={{ color: '#333' }}>
✅ <div className="bg-primary text-primary-foreground rounded-xl p-4">
```

A hex code in a component is a bug. It won't respond to dark mode, it can't be re-themed
per tenant, and it will drift.

**Colours are authored in `src/platform/design/tokens.ts`, not in `src/styles.css`.**
The stylesheet is generated (`bun run tokens`) and CI fails if the two disagree. Editing
the generated block appears to work and is silently reverted the next time anyone
regenerates. The TypeScript file is also what the React Native build imports, which is
the reason it, rather than the CSS, is the source of truth.

The Core HR values are written in `tokens.ts` **as the prototype's own hex codes** and
converted by `hexToOklch`, so a token is the designed colour rather than a hand-rounded
copy of it. `tokens.test.ts` asserts the palette still matches the prototype, and lists the
only three places it deliberately does not (§3).

---

## 2. Token architecture — three tiers

```
Tier 1  Primitive   Raw values. Never referenced by a component.
                    teal: hex("#0f5f79")

Tier 2  Semantic    Meaning, not appearance. What components use.
                    primary: P.teal      successMuted: P.greenSoft

Tier 3  Component   Only when a component needs to deviate systematically.
```

Components consume **Tier 2 only**. Tier 2 keeps shadcn's names (`background`, `card`,
`muted`, `accent`…) so every existing screen re-themed without being touched, and adds
the Core HR roles shadcn has no word for. The prototype's variable names map like this:

| Prototype                        | Token                                     | Tailwind                           |
| -------------------------------- | ----------------------------------------- | ---------------------------------- |
| `--ground`                       | `background`                              | `bg-background`                    |
| `--surface`                      | `card`, `popover`                         | `bg-card`                          |
| `--surface-2`                    | `secondary`, `muted`                      | `bg-muted`                         |
| `--surface-3`                    | `surface3`                                | `bg-surface3`                      |
| `--ink`                          | `foreground`                              | `text-foreground`                  |
| `--ink-2`                        | `foregroundSecondary`                     | `text-foreground-secondary`        |
| `--ink-3`                        | `mutedForeground`                         | `text-muted-foreground`            |
| `--line`                         | `border`                                  | `border-border`                    |
| `--line-2`                       | `borderStrong`                            | `border-border-strong`             |
| (none)                           | `input` (field boundary, 3:1)             | `border-input`                     |
| `--accent`                       | `primary`, `ring`                         | `bg-primary`, `text-primary`       |
| `--accent-ink`                   | `primaryForeground`                       | `text-primary-foreground`          |
| `--accent-soft`                  | `accent` (text on it: `accentForeground`) | `bg-accent text-accent-foreground` |
| `--accent-line`                  | `accentLine`                              | `border-accent-line`               |
| `--ok` `--warn` `--bad` `--info` | `success` `warning` `destructive` `info`  | `text-success`, `bg-success`       |
| `--*-soft`                       | `successMuted` …                          | `bg-success-muted`                 |
| `--*-line`                       | `successLine` …                           | `border-success-line`              |
| `--shadow`, `--shadow-lg`        | `SHADOW.card`, `SHADOW.overlay`           | `shadow-card`, `shadow-overlay`    |

> **Do not confuse shadcn's `accent` with the Core HR accent.** In shadcn `accent` is the
> hover and selected surface. That is the prototype's `--accent-soft`, and that is what it
> holds. The Core HR accent colour itself is `primary`.

`brand` is **not** the product accent. It stays Neuvto's published sky blue `#0EA5E9`
for the landing page, logo and social card. Repainting the brand is a marketing decision,
not a theme one, and D76 did not make it.

---

## 3. Colour

### The three deliberate differences from the prototype

Each failed `tokens.test.ts`, and each was fixed by the smallest same-hue step that passes:

| Token                    | Prototype            | Neuvto    | Why                                                                                                    |
| ------------------------ | -------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `mutedForeground`, light | `#6d8087`            | `#5a6c73` | Captions and hints are text. The prototype measures 3.80:1 on the page, 3.66:1 on a panel. AA is 4.5:1 |
| `input`, light           | `--line-2` `#c5d1d5` | `#828d91` | A field border measuring 1.56:1 cannot be found on a phone in daylight. WCAG 1.4.11 asks 3:1           |
| `input`, dark            | `--line-2` `#35474f` | `#5e717a` | Same rule, dark theme                                                                                  |

`borderStrong` keeps the prototype's `--line-2` for decorative edges, where 3:1 does not
apply. A future design revision that fails the suite is fixed in `tokens.ts` with its
measurement, never in the generated CSS.

### Status

Status colour is separate from the accent and never counts as it. Each status has a strong
colour, a `-muted` soft fill, and a `-line`.

| Status      | Light     | Dark      | Meaning                                   |
| ----------- | --------- | --------- | ----------------------------------------- |
| success     | `#2d7a48` | `#66c286` | Approved, current, sufficient, passed     |
| warning     | `#94620a` | `#dca63f` | Pending, expiring, needs attention        |
| destructive | `#a62a20` | `#e98a80` | Rejected, refused, failed, over the limit |
| info        | `#3f548e` | `#8fa3dd` | Informational, holiday, upcoming          |
| neutral     | `#5a6c73` | `#7b8f98` | Draft, cancelled, **archived**, inactive  |

**A pill is text in the status colour, on its `-muted` fill, with a 1px `-line` border.
Never a solid block** (`<Pill tone="success">Current</Pill>`). Every status-on-soft pairing
clears AA and is in the contrast suite, because a pill is the most common place a status
word is read. The `Archived` pill on a closed history row is `neutral`.

Solid status fills (`bg-success text-success-foreground`) exist for the approve and reject
buttons. White labels on light and near-black on dark, all at least 5.2:1.

### Dark mode

Every token has a dark value, and a component that only works in light is incomplete.
Which surface gets which theme is decided by `resolveTheme` in
`src/platform/design/theme.ts`:

| Surface                     | Theme                           | Why                                                                                     |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `/neuvto-hq`, the console   | **light, always**               | A platform admin must never mistake the console for a tenant workspace (D42).           |
| everywhere else, `/app` too | follows the device, toggle wins | D77. The person's own setting is the best signal; an explicit choice beats it both ways |

Three states must all work: explicit light, explicit dark, and **unset**, where only
`prefers-color-scheme` decides. Dark borders are opaque values, never `white / 12%`: a
translucent border composites differently over the page than over a card, so only one of
the two was ever checked. No dark status exceeds chroma 0.14, because a full-chroma green
on near-black glares at night (asserted).

---

## 4. Typography

**IBM Plex Sans for everything. IBM Plex Mono for employee codes, dates, reference numbers
and numeric table columns.** Loaded from Google Fonts (free). `--font-display` still exists
and points at Plex Sans, so headings written before D76 resolve.

| Role            | Size   | Weight | Tracking  | Notes                   |
| --------------- | ------ | ------ | --------- | ----------------------- |
| Page title      | 20px   | 600    | `-0.02em` |                         |
| Card title      | 14px   | 600    | `-0.01em` |                         |
| Body            | 14px   | 400    |           |                         |
| Table cell      | 13px   | 400    |           |                         |
| Table header    | 10.5px | 600    | `0.07em`  | uppercase               |
| Eyebrow         | 10px   | 600    | `0.11em`  | uppercase               |
| Stat number     | 27px   | 600    | `-0.03em` | `tabular-nums`          |
| Caption, hint   | 11.5px | 400    |           | `text-muted-foreground` |
| Code, date, ref | 12px   | 400    |           | `font-mono`             |

Values live in `TYPE.roles` in `tokens.ts`; native multiplies each size by the OS font
scale rather than treating it as final (Dynamic Type, Android font scaling).

**`tabular-nums` is mandatory on every number that changes**: balances, day counts,
shares, money. Without it digits jitter as they update.

**16px minimum for any input on a touch device, and this outranks the prototype's 13.5px
fields.** Below 16px iOS Safari zooms the viewport on focus and throws the form sideways
mid-typing. Fields are 16px at phone width and the prototype's size above it.

---

## 5. Spacing, radius, elevation

**Spacing:** 4px base scale (`1`=4, `2`=8, `3`=12, `4`=16, `6`=24, `8`=32). Nothing off-scale.
Screen padding is 20px, 16px under the `app` container's 640px. Gap between cards 14px
(the prototype's value; use `gap-3.5`).

**Radius**, from `RADIUS_BASE = 8`: `rounded-sm` 4 (tags) · `rounded-md` 6 (buttons,
inputs, the prototype's `--r-sm`) · `rounded-lg` 8 (panels, `--r`) · `rounded-xl` 12
(cards, stat tiles, modals, `--r-lg`) · `rounded-full` (pills, avatars).

**Elevation:** a card has a 1px `border` **and** `shadow-card`. Overlays (modal, nav panel)
use `shadow-overlay`. In dark the border carries the edge and the shadow only adds depth,
so nothing depends on a shadow being seen.

---

## 6. Layout: container queries, not media queries

**This is the rule that makes everything else work.** Layout responds to the width of its
container, not the browser window. It is what lets one component render correctly in a
narrow pane, beside a sidebar, or in a device preview frame.

Two named containers, set by the shell:

```css
.app-stage {
  container: app / inline-size;
} /* the whole shell */
.app-screen {
  container: screen / inline-size;
} /* the content area, inside the rail */
```

In Tailwind: `@container/app` and `@container/screen`, queried with
`@max-[1000px]/app:` and `@max-[820px]/screen:` and so on.

`app` drives the shell (rail, top bar, tab bar). `screen` drives content (grids, two-pane
layouts, card rows). The breakpoints are the prototype's:

| Container | Max width | What changes                                              |
| --------- | --------- | --------------------------------------------------------- |
| app       | 1000px    | Module rail becomes a horizontal row, top bar unsticks    |
| app       | 640px     | Screen padding 16px, top bar wraps, search on its own row |
| app       | 560px     | Module rail becomes a 2-up grid with short labels         |
| app       | 641–1240  | Global search hides                                       |
| screen    | 1040px    | 3-up stat grid → 2-up                                     |
| screen    | 860px     | 3-up card grid → 2-up                                     |
| screen    | 820px     | `.split` two-pane → one column                            |
| screen    | 740px     | 4-up stat strip → 2-up                                    |
| screen    | 700px     | Config two-pane collapses, section nav goes horizontal    |
| screen    | 640px     | Approval chain steps stack                                |
| screen    | 600px     | Balance tiles single column                               |
| screen    | 520px     | Card grid single column                                   |
| screen    | 460px     | Stat strip single column                                  |

Two things that bite:

- `1fr` is `minmax(auto, 1fr)` and will not shrink below its content. **Always write
  `minmax(0,1fr)`**, and `minmax(min(240px,100%),1fr)` inside `repeat(auto-fit, …)`.
  Getting this wrong is what makes a card overflow its column at phone width.
- A grid whose item count is fixed uses an **explicit column count** stepping down (3 → 2 →
  1), not `auto-fit`. Six tiles at `auto-fit` give five columns and an orphan.

**Short viewport.** Phone landscape is ~390px tall. The shell sets `data-short` on the
stage when its usable height is under 600px; the rail loses its label, breadcrumb and
search hide, tabs and stat tiles shrink. Do not use a height media query: the stage height
is not the window height.

**Nothing scrolls sideways, ever,** except a table inside its own wrapper and the org chart
inside its own container. `document.documentElement.scrollWidth === clientWidth` on every
route at 390, 640, 834, 1112 and 1440px is a test, not a hope.

---

## 7. Navigation

The shell is a **module rail** plus, per module, a **tab bar**. Each module owns its tabs,
split into two groups (this is how a module stays at five or six visible tabs):

- **Main tabs**, in the row: what an employee or approver uses.
- **Company tabs**, behind one `Company` menu at the end of the row, for Admin and above,
  each with a one-line description.

A tab the role cannot use is **not rendered**, not disabled. When tabs are hidden for the
role, a muted `2 tabs hidden for this role` note sits at the end of the row; it is the
first thing dropped when space is tight. `Approvals` appears when the person can approve
(§7 of [NEUVTO_EMPLOYEE_MASTER.md](../product/NEUVTO_EMPLOYEE_MASTER.md) on how that is
derived).

### Algorithm 1: adaptive tab bar

```
PICK_WIDTH = 540
mode = navWidth() < PICK_WIDTH ? 'pick' : 'row'
```

**Pick mode.** The whole row collapses to one button, `Section / <current>`, with
`N sections [badge] ›` on the right. It opens a panel grouped as: the module's own
sections, then `For your team` (Approvals), then `Company` (with descriptions), then a
footer saying how many are hidden for this role.

**Row mode,** priority plus overflow:

1. Render every main tab, a hidden `More`, the `Company` button and the role note.
2. Measure. `W = bar.clientWidth - 30`. `Company` plus its separator is fixed width.
3. If everything including the role note fits, stop.
4. Hide the role note. If it now fits, stop.
5. Show `More`. Budget is `W - fixed - moreWidth`, less 28px if any tab carries a badge
   (the `More` button may grow a red count).
6. Walk tabs left to right accumulating widths. The first that does not fit is the cut;
   hide it and everything after.
7. **If the active tab is in the hidden set, un-hide it and hide the last visible
   non-active tab instead.** Nobody lands on a page whose tab they cannot see.
8. Set the `More` count, red if any hidden tab carries pending items.

Re-measure on every render (`requestAnimationFrame`), on resize, and when the container
changes. If the measured mode differs from the rendered mode, re-render before fitting.
Rendering before layout settles and never re-checking is a real bug the prototype caught.

### Algorithm 2: module rail

| Mode     | Width      | Behaviour                                                                                   |
| -------- | ---------- | ------------------------------------------------------------------------------------------- |
| `column` | > 1000px   | Vertical rail, 246px. Section headings once the suite passes 6 modules                      |
| `row`    | 540–1000px | Horizontal row with priority plus overflow into a `Modules` chip                            |
| `grid`   | < 540px    | 2-up grid with short labels, capped at 4, rest behind `All N modules` with a combined badge |

Modules carry a `section` (`Time`, `People`, `Money`, `Company`). Group by section
properly, collecting unique sections in first-appearance order; never emit a heading
whenever the value changes (a module appended out of order then duplicates a heading).

The rail lists only the modules **granted and switched on** for this organisation
(D44). Adding a module is a manifest change only (D32). With 12 modules nothing scrolls
sideways at any width.

### Native (Core HR Mobile)

Five bottom tabs: **Home, Leave, Attendance, Approvals, Me** (`MAX_VISIBLE_TABS = 5`, the
`UITabBar` limit). iOS uses large titles, inset grouped lists and sheets; Android uses a
top app bar, cards, an extended FAB and a navigation bar. Not one layout squeezed onto two
phones: each platform gets its own controls. Administration, reports and configuration are
**absent** from mobile. See `NEUVTO_NATIVE_TRANSLATION.md`.

---

## 8. Components

Shared primitives live in `src/components/shared/`. The shadcn files in
`src/components/ui/` are not hand-edited; Core HR components wrap them.

| Component          | Notes                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Card`             | title, sub, actions, body, footer (footer on `bg-muted`). `tight` for a flush table                                                   |
| `DataTable`        | Column defs with `key`, `label`, `align`. Own `overflow-x:auto` wrapper, `min-width:560px` table. Sticky header. Empty state required |
| `Pill`             | tones `success warning destructive info neutral accent`. Text, 1px line, soft fill; never solid                                       |
| `Tag`              | mono 11px chip for codes and dates (`NW-0412`, `Joined 02 Aug 2021`)                                                                  |
| `StatTile`         | name, number, unit, optional meter, legs. A 3px left stripe carries the tone                                                          |
| `Field`            | label, control, hint, required marker. Every control has a stable `id` and a real `<label>`                                           |
| `SegmentedControl` | Sub-tab switching inside a screen. Wraps, never scrolls                                                                               |
| `Chain`            | Approval levels, `done` `current` `upcoming`. Stacks under 640px                                                                      |
| `Modal`            | Centred, scrollable body, sticky header and footer. `wide` at 900px                                                                   |
| `Drawer`           | Side panel for edit forms                                                                                                             |
| `Toast`            | Bottom centre, at most 3 stacked, auto-dismiss 2.4s                                                                                   |
| `NavPanel`         | The dropdown behind `More`, `Company`, the section picker and the module picker                                                       |
| `Note`             | Inline explanation strip, tones info / warning / success / destructive                                                                |
| `TemporalTable`    | Address and deployment history. Closed rows muted with an `Archived` pill and **no edit or delete control rendered**                  |
| `RepeatRows`       | Family, nominees, previous organisations. Add and remove, no cap, relation from a select                                              |
| `Forbidden`        | The 403 state: what was refused, which role is needed, who to ask. **Never an empty table**                                           |

**Buttons:** primary (`bg-primary`, one per view), default (surface, `border-border-strong`),
ghost, danger (`destructive` on its soft fill), approve (`success` on its soft fill). A
button says what happens (`Send invite`, `Save and archive the old one`), and the toast
says it happened (`Invite sent`). On touch, every control is at least 48px
(`MIN_TOUCH_TARGET`). Never disable a submit without saying why on screen.

**Tables:** numeric columns right-aligned in mono with tabular numerals. Codes, refs and
dates in mono at 12px. Row hover changes background only, never size. At most two controls
in an action cell; a third goes in an overflow menu. Horizontal scroll belongs to the
table's wrapper, never the page.

**Every async view ships loading, empty, error and forbidden states.** Loading uses
skeletons matching the final layout, not a centred spinner.

---

## 9. Accessibility — non-negotiable

- **Contrast ≥ 4.5:1** for text, ≥ 3:1 for UI boundaries, in both themes. Computed for
  every pairing by `tokens.test.ts`; nobody's judgement.
- **Never colour alone.** Every pill carries a word.
- Focus ring on every interactive element: `2px solid` `--ring`, offset 2px.
- Tabs are `role="tab"` in a `role="tablist"`, with arrow-key movement.
- Panels and modals close on `Escape` and on outside click, trap focus, and return it to
  their trigger.
- Every control has a programmatically associated label. Placeholder text is not a label.
- `aria-live="polite"` announces toasts and running totals (a nominee share sum).
- Respect `prefers-reduced-motion`.

## 10. Motion

Fast and few. 150ms for hover and toggles, 200ms for panels, 300ms for sheets and modals.
Nothing longer. Animate only `transform` and `opacity`.

## 11. Copy

- Sentence case everywhere except the uppercase eyebrow and table headers.
- Errors say what went wrong and what to do. No apologies.
- **Explain a rule where the user meets it,** not in a help page: the archive note sits on
  the History tab; the share-total rule sits on the nominee table header.
- New on-screen copy uses no em dash characters (commas, colons, parentheses). This is a
  Core HR rule for what a user reads; it is not applied retroactively to code comments.

---

## 12. Build-tool rules

For Lovable's agent and any AI writing UI:

1. Never emit a hex, rgb, or arbitrary Tailwind colour (`bg-[#...]`) in `src/modules`,
   `src/platform` or `src/components/shared`.
2. Never hand-edit `src/components/ui/*`. Wrap it.
3. A new colour need is raised as a token in `tokens.ts` first, and must pass the contrast
   suite before it exists.
4. Container queries for layout, never viewport breakpoints inside a screen.
5. Dark mode in the same change, never a follow-up.
6. Every async view ships loading, empty, error and forbidden states.
7. Numbers that change get `tabular-nums`; codes and dates get `font-mono`.
8. A hidden tab or a refused field is **absent**, not disabled and not masked client-side.

### Deliverable checklist for any new screen

- [ ] Light, dark, and unset (device) theme
- [ ] 390, 834 and 1440px with no horizontal page scroll
- [ ] Every interactive state: default, hover, focus, active, disabled, loading
- [ ] Empty, loading, error and forbidden states
- [ ] Colours named by token, not hex
- [ ] Touch targets ≥ 48px, inputs ≥ 16px on touch
- [ ] A render test per role, watched failing first (CLAUDE.md)

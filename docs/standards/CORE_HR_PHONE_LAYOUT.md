**Version:** 1.0 · **Status:** Reference · **Source:** the Core HR design pack, doc 11, from Sada on 23 Oct 2026

> Kept as received. What Neuvto built from it, and what it deliberately left for later,
> is in [NEUVTO_DESIGN_SYSTEM.md](NEUVTO_DESIGN_SYSTEM.md) §7, "The phone shell, under
> 600px" (D115). Where the two differ, §7 says what Neuvto does.

# 11. The phone layout, every module

**Scope: viewport under 600px only.** At 600px and above, docs 07, 08 and 09 apply unchanged: the rail, the tab row and the two pane layouts all stay. This document specifies what replaces them below 600px, for **every module**, present and future. Same data, same API, same permissions. Only the navigation layer differs.

The reference implementation is the Core HR Suite prototype. Where this document and the prototype disagree, this document wins.

---

## 11.1 The rule

**There is no tab row on a phone, at any level.**

Every module has more sections than fit across 390px, and some screens have a second level of sections inside them:

| Module               | Sections | Second level                                                     |
| -------------------- | -------- | ---------------------------------------------------------------- |
| Leave Management     | 7        | Configuration has 10                                             |
| Shift and Attendance | 8        | Configuration has 4                                              |
| Employee Card        | 5        | A person's record has 7, Add Employee has 8, Configuration has 5 |
| Payroll Management   | 7        | Configuration has 4                                              |

Both levels use the same two part pattern:

1. **A list is the home of each level.** A module home is a grid of action tiles. A record home is a list of its own sections. Everything at that level is visible on one screen with no sideways scrolling.
2. **The app bar title opens that level's list from anywhere inside it.** The title is a button carrying the current section's name and a chevron. Tapping it opens a bottom sheet listing every section of the level you are in, grouped, with a one line description each.

One tap from a level's home to any section. Two taps from any section to any sibling, with the whole list visible while choosing.

**Chrome above the content is 64px on every screen in every module.** No exceptions. The build this replaced spent 570px of 844, and the scrollable tab version spent 112px.

---

## 11.2 The three navigation surfaces

| Surface           | Size | Holds                                                | Rules                                                                                                                                                                                                                  |
| ----------------- | ---- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bottom navigation | 80px | 3 to 5 modules                                       | Lives at the foot. Pill indicator behind the active icon, label always visible, badge for a count. Past five modules the last slot becomes `More` and opens the drawer. It never changes when you move inside a module |
| Top app bar       | 64px | Leading slot, title menu, at most two trailing icons | Leading slot is a back arrow, or the avatar at a module home. Trailing is search and notifications at a module home, an overflow menu elsewhere. No breadcrumb, no role switcher, no inline search field               |
| Section sheet     | auto | Every section of the current level                   | Modal bottom sheet, 18px top corners, drag handle, grouped, 52px rows, current row highlighted, counts as badges. Scrolls internally past 78 percent height                                                            |

Plus the navigation drawer, opened from the avatar, holding the module list, the role and the theme, and the extended FAB carrying the module's one primary action.

### Behaviour

1. **Back** goes one level: section to the level's home, level home to the module home.
2. **Sideways within a level replaces the history entry.** Back from a section reached through the title menu lands on that level's home, never on the previously visited section.
3. **Escape, or the Android back gesture, closes an open sheet first**, then navigates.
4. **A section the viewer may not open is absent**, from the tile grid, from the section list and from the sheet. Three places, one source of truth, and no empty group heading left behind.
5. The sheet footer states how many sections are hidden for this role, when any are.

---

## 11.3 The module home

The first visible section of each module is its home. On a phone it opens with:

- any state card the module leads with (a punch card for Attendance, a balance strip for Leave),
- an eyebrow reading `What do you want to do`,
- a **two column tile grid**, one tile per other visible section, each carrying a live state line and a badge where there is a count,
- a single full width `Company` tile when the role has admin sections, which opens the sheet at the Company group.

Tile state lines come from the API. They are what make the home screen answer the common questions before anyone taps.

| Module        | Tiles for an employee                                                                                         | Extra tiles for an admin                |
| ------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Leave         | Apply (`5.25 days available`), My Leave (`2 waiting, 9 taken this year`), Comp Off (`3 available, 1 waiting`) | Approvals (`6 waiting on you`), Company |
| Attendance    | Clock In / Out (`Clocked in at 09:12`), My Attendance (`21 of 22 days`), Shift Roster, Regularisation         | Approvals, Company                      |
| Employee Card | Directory (`248 people, 9 departments`), Org Chart (`4 levels from you`)                                      | Company                                 |
| Payroll       | Salary Structure, Tax and Declarations, Reimbursements                                                        | Company                                 |

---

## 11.4 A second level inside a screen

Any screen whose content is itself divided into sections declares them, and the app bar carries them. In the prototype this is one call:

```js
declareSubNav({
  title: "Employee Card", // what the sheet is titled
  items: [{ id, label, icon, hint, grp }],
  current: view, // "" means show the index
  clear: "setSub('')", // what the back arrow does
});
```

With `current` empty the screen renders its **index**: the record header, then a `sectionList` of its sections with a one line hint each. With `current` set it renders only that section, and the app bar title becomes the section name with a chevron.

The screens that need this today:

| Screen                                      | Sections                                                                       | Groups in the sheet                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| A person's record                           | Overview, Personal, Family, Employment, Statutory and bank, Documents, History | `Record`, `Compliance`, `Audit trail`                |
| Add Employee                                | 8 form sections                                                                | one group, with `Done` and `Next` states on the rows |
| Leave Configuration                         | 10 sections                                                                    | one group, numbered                                  |
| Attendance, Payroll, Employee Configuration | 4, 4 and 5 sections                                                            | one group, numbered                                  |

Configuration is the same idea reached a cheaper way: its existing two pane nav becomes a **vertical list** on a phone, never a horizontal scroller.

---

## 11.5 What else changes below 600px

| Desktop                                        | Phone                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Module rail                                    | Bottom navigation                                                                                        |
| Top bar with breadcrumb, role switcher, search | 64px app bar with a title menu                                                                           |
| Tab row                                        | Gone. Tiles and the section menu                                                                         |
| Two pane layout                                | One column                                                                                               |
| Segmented control inside a screen              | Stays, it wraps and never scrolls                                                                        |
| Chip row for sub views                         | Stays, it wraps and never scrolls                                                                        |
| Dropdown or select                             | Bottom sheet                                                                                             |
| Centred dialog                                 | Bottom sheet                                                                                             |
| Data table                                     | Keeps its columns and scrolls **inside its own wrapper**, minimum 680px. The page never scrolls sideways |
| Inline row actions                             | Act on the card, confirm with a snackbar carrying `Undo`                                                 |

---

## 11.6 Components

All of these are platform components in `src/components/`, not module code. Every module uses all of them.

| Component      | Spec                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `BottomNav`    | 80px, 3 to 5 modules, pill indicator, badges, `More` past five                                                                                  |
| `AppBar`       | 64px, sticky, never collapses. Back arrow or avatar leading, two trailing icons at most                                                         |
| `TitleMenu`    | The app bar title as a button: section name, subtitle, chevron. Opens `SectionSheet`                                                            |
| `SectionSheet` | Grouped list of the current level's sections, current one highlighted, badges, omits what the role cannot open, footer counting hidden sections |
| `ActionTiles`  | Two column grid, 104px minimum, icon chip, label, live state line, optional badge, full width variant                                           |
| `SectionList`  | The index of a second level: 58px rows, icon, label, hint, chevron or badge                                                                     |
| `BottomSheet`  | Phone replacement for every dropdown and centred dialog                                                                                         |
| `Snackbar`     | 96px from the foot, one at a time, `Undo` where the action is reversible                                                                        |
| `ExtendedFab`  | One per module, hidden on the level's home and on the screen it points at                                                                       |

---

## 11.7 Acceptance criteria

Automate all of these. They are the regression suite for the phone layout, and they run against **every module and every section**, not a sample.

1. At 390 by 844, the app bar is **64px and nothing else sits above the content**, on every screen, in every module, for every role. No screen renders a tab row.
2. `document.documentElement.scrollWidth === clientWidth` at 360, 390, 430, 599, 834 and 1440px, on every section of every module.
3. No tappable element resolves to under 48px including its hit area.
4. The title menu opens from every screen, lists exactly the sections the role may open, highlights the current one, and omits the rest entirely.
5. Moving sideways within a level and then pressing back lands on that level's home.
6. No `.cfgnav` and no chip row has `scrollWidth > clientWidth`. A data table may, inside its own wrapper.
7. The module home renders the hub; an open second level section does not render it above the content.
8. Crossing 600px in either direction re renders the shell: below it the tab row is absent from the DOM, above it the desktop layout returns.

The prototype passes all eight at 360, 390, 430, 599, 834 and 1440px across all four modules, with no console errors.

---

## 11.8 Build order

These replace the phone work in Milestone 0 and apply to every module as it is built.

| Ticket | Work                                                                | Done when                                                                                 |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| T0.5b  | `AppBar`, `TitleMenu`, `SectionSheet`, `BottomNav`                  | Criteria 1, 4 and 8 pass with a stub module                                               |
| T0.5c  | `ActionTiles` and `SectionList`, plus the `declareSubNav` mechanism | A screen can declare its own sections and the app bar carries them. Criteria 5 and 7 pass |
| T0.6   | Tab bar returns null below 600px, priority plus overflow above it   | Criterion 1, and the same sections array feeds the tabs, the tiles and the sheet          |
| T0.7b  | `BottomSheet` and `Snackbar`, and the select to sheet conversion    | No native select renders below 600px                                                      |
| T4.1   | The eight criteria above, automated at six widths and four roles    | All eight green in CI                                                                     |

Every module ticket afterwards inherits this. A module is not done until its sections render as tiles, its sheet lists them correctly and its tables scroll inside their own wrappers.

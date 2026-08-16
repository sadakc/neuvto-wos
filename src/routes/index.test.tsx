// @vitest-environment happy-dom

/**
 * The marketing header, and the one action it is allowed to offer twice.
 *
 * "Request Demo" appeared in this header TWICE — once as a muted text link in
 * the `hidden md:flex` nav row next to Roadmap, and once as the filled
 * `bg-primary` button next to Sign in. Two controls, three inches apart, the
 * same destination. A visitor reads them as two different things, and the
 * primary call to action competes with a grey link for the same click.
 *
 * That has now happened twice. Nothing catches it: it compiles, it types, it
 * lints, and every other test in this project is a pure function. The only
 * thing that ever noticed was a person looking at the live site.
 *
 * So the promise pinned here is a count, not a coverage number: the header
 * offers this action exactly once, and the once is the button.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "@/components/ui/sonner";

// ── the seam
//
// index.tsx is a route module: it calls createFileRoute at module load, and the
// demo form posts to the demo-request edge function. Both are replaced so the
// test is about what the page puts on screen. Nothing else is mocked away — the
// whole page renders, which is what lets the header's count be checked against a
// page that also says "Request demo" on its form button, and what lets the form
// be filled the way a visitor fills it.
//
// `submitDemoRequest` is the only thing on this page that reaches the network,
// and src/test/setup.ts fails any file that reaches it. Named so a failure reads
// as "expected submitDemoRequest to have been called once" rather than
// "expected vi.fn()" — which of the five values arrived on which key is the
// entire content of one assertion below.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

vi.mock("@/lib/demo-request", () => ({
  submitDemoRequest: vi.fn().mockName("submitDemoRequest"),
}));

import { submitDemoRequest } from "@/lib/demo-request";
import { Route } from "./index";

const Index = (Route as unknown as { component: () => React.ReactElement }).component;

beforeEach(() => {
  // The name is re-applied after every reset: `mockReset()` drops it, and a
  // failure that reads "expected vi.fn() to be called 1 times" says nothing
  // about which call did not happen. Watched printing exactly that.
  vi.mocked(submitDemoRequest)
    .mockReset()
    .mockName("submitDemoRequest")
    .mockResolvedValue(undefined);
});

function renderLanding() {
  render(<Index />);
  // <header> is the banner landmark. Scoping to it is the whole point: the page
  // legitimately says "Request demo" further down, on the form's submit button.
  return screen.getByRole("banner");
}

describe("landing header — Request Demo appears once", () => {
  it("offers exactly one Request Demo, and it is the filled button", () => {
    // THE REGRESSION. Before the fix this found two: the muted nav-row link and
    // the button. The count is deliberately case-insensitive — a duplicate
    // re-added as "Request demo" is the same duplicate.
    const header = renderLanding();

    const ctas = within(header).getAllByRole("link", { name: /^request demo$/i });
    expect(ctas).toHaveLength(1);

    const cta = ctas[0];
    expect(cta).toHaveAttribute("href", "#demo");
    // The filled primary button, not a muted text link. Both halves matter: the
    // duplicate that keeps coming back is precisely a `text-muted-foreground`
    // one, so a survivor with that class is the wrong survivor.
    expect(paintedClassesOf(cta)).toContain("bg-primary");
    expect(paintedClassesOf(cta)).not.toContain("text-muted-foreground");
  });

  it("keeps the call to action out of the row that disappears on mobile", () => {
    // The duplicate lived inside `hidden gap-8 ... md:flex`. A second copy there
    // is not merely redundant — it is invisible on a phone, so the two copies
    // disagree about whether the header has a CTA at all depending on width.
    const header = renderLanding();

    const navRow = within(header).getByRole("navigation");
    expect(navRow.className).toContain("hidden");
    expect(within(navRow).queryByRole("link", { name: /request demo/i })).toBeNull();

    // And the surviving one sits in the group that is always on screen — the
    // same group as Sign in.
    const cta = within(header).getByRole("link", { name: /^request demo$/i });
    const group = cta.parentElement as HTMLElement;
    expect(within(group).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends that button somewhere that exists on the page", () => {
    // An anchor to #demo with no #demo is a button that does nothing. The whole
    // page is rendered here so this is a real check, not a spelling check.
    const header = renderLanding();
    const cta = within(header).getByRole("link", { name: /^request demo$/i });
    const target = cta.getAttribute("href")!.slice(1);
    expect(document.getElementById(target)).not.toBeNull();
  });
});

describe("landing header — what must survive the deletion", () => {
  it("still offers Sign in, pointing at /auth", () => {
    // The only route into the product from this page. Deleting a duplicate CTA
    // three lines away from it is exactly the edit that takes it out by mistake.
    const header = renderLanding();
    expect(within(header).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth");
  });

  it("keeps Sign in outside the md-only nav row, so a phone can reach it", () => {
    // Somebody who has lost their invitation email arrives on a phone. If Sign
    // in were tidied into the nav row above, it would vanish under 768px and the
    // product would have no door on mobile.
    const header = renderLanding();
    const navRow = within(header).getByRole("navigation");
    expect(within(navRow).queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("still resolves every nav destination", () => {
    const header = renderLanding();
    const navRow = within(header).getByRole("navigation");

    expect(within(navRow).getByRole("link", { name: "Vision" })).toHaveAttribute("href", "#vision");
    expect(within(navRow).getByRole("link", { name: "Leave Management" })).toHaveAttribute(
      "href",
      "#leave",
    );
    expect(within(navRow).getByRole("link", { name: "Roadmap" })).toHaveAttribute(
      "href",
      "#roadmap",
    );
    expect(within(navRow).getByRole("link", { name: "Websites" })).toHaveAttribute(
      "href",
      "#websites",
    );

    // Each one lands on a section that is actually on the page — a nav link to a
    // renamed anchor scrolls nowhere and reports nothing. Compared as a list so
    // the failure names the anchor that went missing, not just "expected null".
    const wanted = ["vision", "leave", "roadmap", "websites"];
    expect(wanted.filter((id) => document.getElementById(id) !== null)).toEqual(wanted);
  });
});

// ── red is a status, not a brand colour
//
// NEUVTO_DESIGN_SYSTEM.md gives `destructive` (#EF4444) exactly two jobs:
// "Rejected, error, over-balance" as a status, and the `destructive` *button
// variant* for "Reject, delete, cancel leave". Two buttons on this page were
// using it as a brand fill for an invitation — the hero "Request early access"
// and the demo form's submit. A red button on the one action the page exists to
// invite reads as a warning about the thing it is offering you.
//
// The distinction the guard below draws is the one the design system already
// draws, and it is a class-shape distinction, not a judgement call:
//
//   FILL ON AN ACTION   bg-destructive, text-destructive-foreground   forbidden here
//   SIGNAL ON TEXT      text-destructive, border-destructive          allowed
//
// So `<span className="text-destructive"> *</span>` on a required field — which
// is the design system's own error/required signal, and correct — stays legal,
// while a red-filled call to action does not. The guard is scoped to elements
// with an interactive role, which is why the asterisk cannot be caught by it
// even if somebody one day gives it a background.

/** Every class on an element, including the ones behind variant prefixes. */
function classesOf(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Every class that PAINTS this control — its own and its descendants'.
 *
 * A control's fill does not have to sit on the control. The header's Request
 * Demo puts `min-h-12` on the <a> and the coloured pill on a <span> inside it,
 * so that the touch target can be 48px while the button stays 36px. The moment
 * that became possible, a guard reading only `el.getAttribute("class")` stopped
 * being able to see the fill it exists to check: a red pill inside a link would
 * have passed the sweep below while rendering exactly the thing it forbids.
 *
 * Found by making that change and watching the header's own assertion fail on
 * `expected 'group inline-flex min-h-12 items-cent…' to contain 'bg-primary'`.
 * That test caught its own case; this function is what stops the next one being
 * a control nobody happens to have written an assertion for.
 */
function paintedClassesOf(el: Element): string[] {
  return [el, ...el.querySelectorAll("*")].flatMap(classesOf);
}

/**
 * Matches `destructive` used as a *fill*, under any variant prefix and any
 * opacity: `bg-destructive`, `hover:bg-destructive/90`, `dark:md:bg-destructive`,
 * `text-destructive-foreground`.
 *
 * Deliberately does NOT match `text-destructive`, `border-destructive` or
 * `bg-destructive-muted` — those are the status/error signals the system asks
 * for, and a guard that banned them would eventually force somebody to strip
 * the red asterisk off a required field to get a build green.
 */
const DESTRUCTIVE_FILL = /^(?:[\w-]+:)*(?:bg-destructive|text-destructive-foreground)(?:\/\d+)?$/;

/** Everything on the page a visitor can click. */
function actionsOnPage(): HTMLElement[] {
  return [...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")];
}

function describeAction(el: Element): string {
  return `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim()}" — class="${el.getAttribute("class") ?? ""}"`;
}

describe("landing page — no invitation is painted as a warning", () => {
  it("fills the hero call to action with primary, not destructive", () => {
    render(<Index />);
    const cta = screen.getByRole("link", { name: "Request early access" });

    expect(cta).toHaveAttribute("href", "#demo");
    // Asserted before the positive check so that a regression fails by *naming
    // the red classes it found*, rather than by reporting a missing bg-primary
    // and leaving the reader to work out what replaced it.
    expect(classesOf(cta).filter((c) => DESTRUCTIVE_FILL.test(c))).toEqual([]);
    expect(classesOf(cta)).toContain("bg-primary");
    expect(classesOf(cta)).toContain("text-primary-foreground");
  });

  it("fills the demo form's submit button with primary, not destructive", () => {
    render(<Index />);
    // The only <button> on the page; the header's "Request Demo" is a link.
    const submit = screen.getByRole("button", { name: "Request demo" });

    expect(submit).toHaveAttribute("type", "submit");
    expect(classesOf(submit).filter((c) => DESTRUCTIVE_FILL.test(c))).toEqual([]);
    expect(classesOf(submit)).toContain("bg-primary");
    expect(classesOf(submit)).toContain("text-primary-foreground");
  });

  it("has no red-filled control anywhere on the page, whatever it is called", () => {
    // THE GUARD, and the reason it is shaped this way. A list of known CTA
    // phrases would pin the two buttons we already know about and miss the third
    // one — "Book a walkthrough", "Talk to us", "Start free" — which is exactly
    // the button somebody adds six months from now by copying the styling off
    // whichever neighbour they had open.
    //
    // This page is marketing. It has no reject, no delete, no cancel: there is
    // no action on it that is *entitled* to a red fill, so the rule is simply
    // that none of them has one. That holds for a control that does not exist
    // yet and has a name nobody has thought of.
    render(<Index />);
    const actions = actionsOnPage();

    // A guard over an empty list passes forever and proves nothing. If the page
    // stops rendering, or the roles change, this fails first and says so.
    expect(actions.length).toBeGreaterThanOrEqual(8);
    expect(actions).toContain(screen.getByRole("button", { name: "Request demo" }));

    const redFilled = actions
      .filter((el) => paintedClassesOf(el).some((c) => DESTRUCTIVE_FILL.test(c)))
      .map(describeAction);

    expect(redFilled).toEqual([]);
  });
});

describe("landing page — what red is still allowed to mean", () => {
  it("keeps the red asterisk on required fields, and only on required fields", () => {
    // The guard above must not be the reason somebody deletes this. `text-…`
    // is the system's error/required signal ("Error: border-destructive plus a
    // message in text-sm text-destructive"), and it is on a <span>, which has
    // no interactive role and is therefore outside the guard's reach entirely.
    render(<Index />);

    const markers = [...document.querySelectorAll("label span")].filter(
      (el) => el.textContent?.trim() === "*",
    );
    // "Your name" and "Work email" are required; Company and # Employees are not.
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(classesOf(marker)).toContain("text-destructive");
    }

    // The marker is meaningless if every field carries one — the optional
    // fields must stay unmarked, or red stops signalling anything.
    const labelled = [...document.querySelectorAll("label")].map((l) =>
      (l.textContent ?? "").trim(),
    );
    expect(labelled).toContain("Your name *");
    expect(labelled).toContain("Company");

    // And it is not an action, so the guard cannot ever be what removes it.
    expect(actionsOnPage()).not.toContain(markers[0] as HTMLElement);
  });
});

// ── every control big enough to hit with a thumb
//
// `MIN_TOUCH_TARGET` is 48 (src/platform/design/tokens.ts) and DESIGN_SYSTEM §6
// says "Touch targets ≥ 48×48px". Measured in real headless Chrome at a 375px
// mobile viewport, FOUR of this page's seven controls were under it:
//
//     Sign in (header)             48px   py-3.5
//     Request Demo (header)        36px   py-2      ← the worst
//     Request early access (hero)  44px   py-3
//     See the vision (hero)        46px   py-3
//     Talk to us about a site      50px   py-3.5
//     Request demo (form submit)   44px   py-3      ← the conversion point
//     Sign in to your workspace    48px   py-3.5
//
// The form submit is the one that matters most: it is where a prospect actually
// converts, and this page is the only way anyone reaches Neuvto.
//
// The THREE NAV LINKS were the ones nobody would have found by looking. They are
// bare 20px text with no padding at all, and they sit in a `hidden md:flex` row —
// so at a phone width they are `display: none` and measure zero, and a sweep that
// skips zero-height elements skips them entirely. They only exist at ≥768px,
// which is a tablet, which is a touchscreen. "Vision" is 41px wide as well as
// 20px tall: under the floor on BOTH axes.
//
// WHAT THIS TEST CAN AND CANNOT SEE, stated plainly rather than implied.
// happy-dom does no layout — every `getBoundingClientRect()` here returns zeroes
// — so a test that appears to measure pixel heights would measure nothing and
// pass forever. That is worse than no test, because it reads as coverage. This
// asserts the DECLARATION instead: `min-h-12` is Tailwind's 3rem, exactly the
// 48 in `MIN_TOUCH_TARGET`, and it is one class meaning one thing.
//
// A declaration rather than padding arithmetic, because the eight controls here
// are a logo wrapping an SVG, three bare text links, three padded buttons and a
// form submit — their content heights are 38, 20 and 20-ish px, so the padding
// that yields 48 is different for each and no single `py-*` rule is true of all
// of them. `min-h-12` is true of all of them and says why it is there.
//
// The real heights were measured in a browser, at 375, 768 and 1280, and are
// recorded above. This guard exists to keep them there.

/** Does this control declare the 48px floor? */
function declaresFloor(el: Element): boolean {
  const classes = el.getAttribute("class") ?? "";
  // `min-h-12` is 48px. Anything larger is fine too; `h-16` and up are explicit
  // fixed heights that already clear it.
  return /(?:^|\s)(?:min-h-1[2-9]|min-h-2\d|h-1[2-9]|h-2\d)(?:\s|$)/.test(classes);
}

describe("landing page — every control is big enough to hit", () => {
  it("declares the 48px floor on every link and button", () => {
    render(<Index />);
    const controls = [...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")];

    // A guard over an empty list passes forever. Eight is the count at the time
    // of writing; asserted as a floor so adding a control cannot silently
    // shrink what this sweeps.
    expect(controls.length).toBeGreaterThanOrEqual(8);

    const undersized = controls
      .filter((el) => !declaresFloor(el))
      .map(
        (el) =>
          `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim() || el.getAttribute("aria-label")}" ` +
          `— class="${el.getAttribute("class") ?? ""}"`,
      );

    expect(undersized).toEqual([]);
  });
});

// ── the second thing this company sells
//
// The page advertised one product. Neuvto also builds websites for other
// companies, and a visitor had no way to learn that — so the section below is
// new positioning rather than a copy tweak.
//
// The rule it ships under is the part worth pinning. THE ONLY EVIDENCE OF TRACK
// RECORD THIS SECTION MAY OFFER IS THE PAGE IT IS ON. No client names, no
// counts, no testimonials, no prices, no turnaround times — we have not shipped
// those clients, and a prospect who checks one invented logo is the prospect who
// was going to buy.
//
// That is a product rule, not a markup rule, so the guard below is structural
// rather than a list of banned phrases — the same shape as DESTRUCTIVE_FILL
// above and for the same reason. Nobody will re-add a fabricated claim by
// writing "trusted by 40 companies" in a string; they will paste in a logo wall,
// a screenshot of somebody else's homepage, or a pull-quote, having copied the
// layout off a competitor's site. A phrase blacklist sees none of that.

describe("landing page — the second thing this company sells", () => {
  it("puts the websites section behind the id, with its heading inside it", () => {
    // The h2 and the section id are what a reader and any future anchor
    // respectively depend on, and nothing else on this page ties them together.
    render(<Index />);

    const heading = screen.getByRole("heading", { level: 2, name: /websites/i });
    expect(heading.closest("section")?.id).toBe("websites");
  });

  it("says enough to be an offering rather than a line", () => {
    render(<Index />);
    const section = document.getElementById("websites");
    expect(section, "no #websites section on the page").not.toBeNull();

    // The h2 plus three cards. A floor, not a count — a fourth card is somebody's
    // decision, a section that quietly decayed to a heading and a sentence is
    // not, and only one of those should fail here.
    const headings = within(section!).getAllByRole("heading");
    expect(headings.length).toBeGreaterThanOrEqual(4);
  });

  it("makes no claim of track record beyond being one of ours", () => {
    // THE GUARD. Listed as what it found rather than asserted as a count, so a
    // regression prints the logo or the quote it caught and the reader knows
    // immediately which thing to take back out.
    render(<Index />);
    const section = document.getElementById("websites");
    expect(section, "no #websites section on the page").not.toBeNull();

    const fabricated = [...section!.querySelectorAll("img, blockquote, q, cite, figure")].map(
      (el) => `<${el.tagName.toLowerCase()}> ${(el.textContent ?? "").trim().slice(0, 40)}`,
    );
    expect(fabricated).toEqual([]);
  });
});

// ── the demo form: five fields that had no names at all
//
// There WERE five `<label>` elements. Not one of them was attached to anything:
// no `htmlFor`, no `id` on the control, and the control not nested inside. So
// every field rendered as a styled paragraph next to an anonymous box, and the
// source read as correct — only the accessibility tree disagreed:
//
//     input[type=text]   id=NONE  → *** NO ACCESSIBLE NAME ***
//     input[type=email]  id=NONE  → *** NO ACCESSIBLE NAME ***
//     …
//
// This is the first form a prospective customer meets, and one of them is using
// a screen reader — which announced five consecutive "edit text, blank".
//
// Everything below is queried BY LABEL and never by placeholder, test id or DOM
// position. That is not a stylistic preference: a query that reaches an input
// any other way passes just as happily against the broken version, which is
// exactly how this shipped. `getByLabelText` and `getByRole(…, { name })` fail
// when the association is missing, and they are the only queries that do.

/** Enough of a control to identify it in a failure message. */
function describeField(el: Element): string {
  const type = el.getAttribute("type");
  return `<${el.tagName.toLowerCase()}${type ? ` type=${type}` : ""}> id=${el.id || "NONE"}`;
}

/**
 * The landing page, plus the toaster the app really mounts.
 *
 * `<Toaster />` is the same component `__root.tsx` renders, so "the visitor is
 * told" can be asserted as text on screen rather than as a call to a mocked
 * `toast`. Mocking sonner would leave these tests unable to tell a message that
 * renders from one that is thrown into a void.
 */
function renderDemoForm() {
  const user = userEvent.setup();
  const { container } = render(
    <>
      <Index />
      <Toaster />
    </>,
  );
  const form = container.querySelector("form");
  if (!form) throw new Error("no <form> on the landing page");
  return { user, form };
}

/** What a real visitor puts in, one distinguishable value per field. */
const TYPED = {
  name: "Priya Raman",
  email: "priya@vistara.test",
  company: "Vistara Facilities",
  employees: "50-200",
  message: "Leave first, attendance next year.",
};

/**
 * Fills every field, reaching each one only by its label.
 *
 * No two values share a prefix, so a crossed association shows up as the wrong
 * string on the wrong key rather than as a passing test.
 */
async function fillByLabel(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Your name/), TYPED.name);
  await user.type(screen.getByLabelText(/Work email/), TYPED.email);
  await user.type(screen.getByLabelText(/Company/), TYPED.company);
  await user.type(screen.getByLabelText(/Employees/), TYPED.employees);
  await user.type(screen.getByLabelText(/interested in/), TYPED.message);
}

describe("demo form — every field answers to its label", () => {
  it("names all five, and the last one is the textarea", () => {
    const { form } = renderDemoForm();

    const fields = {
      name: screen.getByLabelText(/Your name/),
      email: screen.getByLabelText(/Work email/),
      company: screen.getByLabelText(/Company/),
      employees: screen.getByLabelText(/Employees/),
      message: screen.getByLabelText(/interested in/),
    };

    // Which control each label reached, not merely that it reached one. A label
    // joined to the wrong element is still a missing name for the right one.
    expect(fields.name.tagName).toBe("INPUT");
    expect(fields.name).toHaveAttribute("type", "text");
    expect(fields.email.tagName).toBe("INPUT");
    expect(fields.email).toHaveAttribute("type", "email");
    expect(fields.company.tagName).toBe("INPUT");
    expect(fields.employees.tagName).toBe("INPUT");
    expect(fields.message.tagName).toBe("TEXTAREA");

    // …and there is no sixth field sitting there nameless. Asserted as a list of
    // leftovers so a regression prints the field it could not name rather than a
    // count.
    const named = Object.values(fields);
    const unnamed = within(form)
      .getAllByRole("textbox")
      .filter((el) => !named.includes(el));
    expect(unnamed.map(describeField)).toEqual([]);
  });

  it("gives each control an id of its own, and each label something to point at", () => {
    // `Field` renders FOUR times on this page. A hand-passed or hard-coded id
    // would make all four labels point at the first input — which reads as
    // fixed, passes any test that only looks for a `for` attribute, and leaves
    // three fields as anonymous as they were.
    const { form } = renderDemoForm();

    const controls = [...form.querySelectorAll("input, textarea")];
    expect(controls).toHaveLength(5);

    const ids = controls.map((c) => c.id);
    expect(controls.filter((c) => !c.id).map(describeField)).toEqual([]);

    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(repeated).toEqual([]);

    const labels = [...form.querySelectorAll("label")];
    expect(labels).toHaveLength(5);
    const dangling = labels
      .filter((l) => !ids.includes(l.htmlFor))
      .map((l) => `"${(l.textContent ?? "").trim()}" → for=${l.htmlFor || "NONE"}`);
    expect(dangling).toEqual([]);
  });

  it("puts what is typed into the field the label named, and into no other", async () => {
    // The association proved rather than assumed. Under one shared id every one
    // of these queries returns the same input, so the four empty assertions are
    // what separates a real `htmlFor` from a coincidental one.
    const { user } = renderDemoForm();

    await user.type(screen.getByLabelText(/Work email/), TYPED.email);

    expect(screen.getByLabelText(/Work email/)).toHaveValue(TYPED.email);
    expect(screen.getByLabelText(/Your name/)).toHaveValue("");
    expect(screen.getByLabelText(/Company/)).toHaveValue("");
    expect(screen.getByLabelText(/Employees/)).toHaveValue("");
    expect(screen.getByLabelText(/interested in/)).toHaveValue("");
  });
});

describe("demo form — what marks a field as required", () => {
  it("hides the asterisk from assistive tech and lets `required` do the announcing", () => {
    const { form } = renderDemoForm();

    const markers = [...form.querySelectorAll("label span")].filter(
      (el) => el.textContent?.trim() === "*",
    );
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker).toHaveAttribute("aria-hidden", "true");
    }

    // The consequence, which is the part worth pinning: the name a screen
    // reader announces is "Your name", not "Your name star". Exact match — an
    // un-hidden asterisk is inside the accessible name and this stops matching.
    expect(screen.getByRole("textbox", { name: "Your name" })).toBe(
      screen.getByLabelText(/Your name/),
    );
    expect(screen.getByRole("textbox", { name: "Work email" })).toBe(
      screen.getByLabelText(/Work email/),
    );

    // And the actual signal is on the control, where it is announced and
    // enforced rather than merely drawn.
    expect(screen.getByLabelText(/Your name/)).toBeRequired();
    expect(screen.getByLabelText(/Work email/)).toBeRequired();

    // The optional three stay optional. A form where everything is required
    // says nothing by marking anything.
    expect(screen.getByLabelText(/Company/)).not.toBeRequired();
    expect(screen.getByLabelText(/Employees/)).not.toBeRequired();
    expect(screen.getByLabelText(/interested in/)).not.toBeRequired();
  });
});

describe("demo form — sending it", () => {
  it("sends exactly what was typed, on the keys it was typed into", async () => {
    // Filled through the labels alone, so this is simultaneously the strongest
    // statement about the association: five distinct strings, and a label wired
    // to the wrong `onChange` arrives here as the wrong value on the wrong key.
    const { user } = renderDemoForm();

    await fillByLabel(user);
    await user.click(screen.getByRole("button", { name: "Request demo" }));

    await waitFor(() => expect(submitDemoRequest).toHaveBeenCalledTimes(1));
    expect(submitDemoRequest).toHaveBeenCalledWith(TYPED);
  });

  it("thanks the visitor and empties the form once it is accepted", async () => {
    const { user } = renderDemoForm();

    await fillByLabel(user);
    await user.click(screen.getByRole("button", { name: "Request demo" }));

    expect(await screen.findByText("Thanks! We'll be in touch shortly.")).toBeInTheDocument();
    // Emptied, so a second visitor at the same laptop does not send the first
    // one's details again.
    expect(screen.getByLabelText(/Your name/)).toHaveValue("");
    expect(screen.getByLabelText(/Work email/)).toHaveValue("");
    expect(screen.getByLabelText(/Company/)).toHaveValue("");
    expect(screen.getByLabelText(/Employees/)).toHaveValue("");
    expect(screen.getByLabelText(/interested in/)).toHaveValue("");
  });

  it("tells the visitor when it is refused, and keeps everything they typed", async () => {
    // A refusal that also wipes the form is a visitor who leaves. The message is
    // the endpoint's own sentence — the one thing here somebody can act on.
    vi.mocked(submitDemoRequest).mockRejectedValueOnce(
      new Error("Please check your email address."),
    );

    const { user } = renderDemoForm();

    await fillByLabel(user);
    await user.click(screen.getByRole("button", { name: "Request demo" }));

    expect(await screen.findByText("Please check your email address.")).toBeInTheDocument();
    expect(screen.queryByText("Thanks! We'll be in touch shortly.")).toBeNull();

    expect(screen.getByLabelText(/Your name/)).toHaveValue(TYPED.name);
    expect(screen.getByLabelText(/Work email/)).toHaveValue(TYPED.email);
    expect(screen.getByLabelText(/Company/)).toHaveValue(TYPED.company);
    expect(screen.getByLabelText(/Employees/)).toHaveValue(TYPED.employees);
    expect(screen.getByLabelText(/interested in/)).toHaveValue(TYPED.message);

    // And the button is usable again, so correcting the address is one edit
    // rather than a reload.
    await waitFor(() => expect(screen.getByRole("button", { name: "Request demo" })).toBeEnabled());
  });

  it("says it is sending, and refuses a second click while it is", async () => {
    // Two clicks is two demo requests: two rows, two emails, and a sales call
    // that opens by apologising. The label matters as much as the disabling — an
    // unchanged button under a click that did something reads as a dead button,
    // which is precisely how people click it again.
    let release!: () => void;
    vi.mocked(submitDemoRequest).mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const { user } = renderDemoForm();
    await fillByLabel(user);
    await user.click(screen.getByRole("button", { name: "Request demo" }));

    const sending = screen.getByRole("button", { name: "Sending…" });
    expect(sending).toBeDisabled();

    await user.click(sending);
    expect(submitDemoRequest).toHaveBeenCalledTimes(1);

    release();
    expect(await screen.findByText("Thanks! We'll be in touch shortly.")).toBeInTheDocument();
  });
});

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

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// ── the seam
//
// index.tsx is a route module: it calls createFileRoute at module load, and the
// demo form binds a server function on mount. Both are replaced so the test is
// about what the page puts on screen. Nothing below the header is mocked away —
// the whole page renders, which is what lets the header's count be checked
// against a page that also says "Request demo" on its form button.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

vi.mock("@/lib/demo-request", () => ({
  submitDemoRequest: vi.fn().mockResolvedValue(undefined),
}));

import { Route } from "./index";

const Index = (Route as unknown as { component: () => React.ReactElement }).component;

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
    expect(cta.className).toContain("bg-primary");
    expect(cta.className).not.toContain("text-muted-foreground");
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

  it("still resolves the three nav destinations", () => {
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

    // Each one lands on a section that is actually on the page — a nav link to a
    // renamed anchor scrolls nowhere and reports nothing. Compared as a list so
    // the failure names the anchor that went missing, not just "expected null".
    const wanted = ["vision", "leave", "roadmap"];
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
      .filter((el) => classesOf(el).some((c) => DESTRUCTIVE_FILL.test(c)))
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

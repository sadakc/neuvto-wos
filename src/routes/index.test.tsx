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

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => vi.fn(),
}));

vi.mock("@/lib/demo.functions", () => ({
  submitDemoRequest: vi.fn(),
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

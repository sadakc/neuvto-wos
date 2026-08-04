// @vitest-environment happy-dom

/**
 * The monitor has to be believable, including when it fails.
 *
 * A panel that says "no front-end errors" when it could not read the error store
 * is worse than no panel at all: it converts an outage into a clean bill of
 * health, and it is one character away (`!groups?.length`). The first three tests
 * exist for that single character. The rest pin what a person actually reads —
 * the count as text rather than as colour, the tone that separates a structural
 * fault from a bad deploy, and the absence of any customer's name (D42).
 *
 * Every assertion below was watched failing before it was believed.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientErrorsPanel } from "./ClientErrorsPanel";
import type { ClientErrorGroup } from "./platform";

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/**
 * Four days, twelve occurrences: nobody has noticed this one. Its message
 * deliberately contains the word "organization" — real stack messages do, and a
 * naive "does the screen contain the word organisation" test would fail on
 * honest data. The tenant check below plants values instead.
 */
const STRUCTURAL: ClientErrorGroup = {
  fingerprint: "f1a2b3c4",
  message: "TypeError: Cannot read properties of null (reading 'organization_id')",
  route: "/app/leave/requests",
  mechanism: "error-boundary",
  severity: "error",
  occurrences: 12,
  daysSeen: 4,
  firstSeenAt: minutesAgo(4 * 24 * 60),
  lastSeenAt: minutesAgo(35),
  release: "9c4e1f7a2b",
  stack:
    "TypeError: Cannot read properties of null (reading 'organization_id')\n" +
    "    at LeaveRequestsRoute (/app/leave/requests-CGh2.js:1:8842)\n" +
    "    at renderWithHooks (/vendor-react-Bq1.js:1:24110)",
};

/** One bad afternoon: 247 occurrences, one day, no stack captured. */
const BURST: ClientErrorGroup = {
  fingerprint: "aa99ff00",
  message: "NetworkError when attempting to fetch resource.",
  route: "/app/team",
  mechanism: "unhandledrejection",
  severity: "error",
  occurrences: 247,
  daysSeen: 1,
  firstSeenAt: minutesAgo(180),
  lastSeenAt: minutesAgo(6),
  release: null,
  stack: null,
};

/** Under both thresholds. Three hits, one day — noise, and drawn as noise. */
const QUIET: ClientErrorGroup = {
  ...BURST,
  fingerprint: "0011dead",
  message: "ResizeObserver loop completed with undelivered notifications.",
  route: null,
  occurrences: 3,
  daysSeen: 1,
};

const SEVERITY_RANK = { neutral: 0, warning: 1, destructive: 2 } as const;

function rowFor(message: string): HTMLElement {
  const row = screen.getByText(message).closest("li");
  if (!row) throw new Error(`no list row rendered for the group "${message}"`);
  return row as HTMLElement;
}

function toneOf(message: string): keyof typeof SEVERITY_RANK {
  const badge = rowFor(message).querySelector("[data-tone]");
  if (!badge) throw new Error(`no severity badge rendered for the group "${message}"`);
  return badge.getAttribute("data-tone") as keyof typeof SEVERITY_RANK;
}

describe("ClientErrorsPanel", () => {
  // ── the one-character regression ───────────────────────────────────────────

  it("says the store could not be read, and does not claim health", () => {
    render(<ClientErrorsPanel groups={null} />);
    expect(screen.getByTestId("client-errors-unknown")).toHaveTextContent(
      "The error store could not be read.",
    );
    expect(screen.queryByTestId("client-errors-none")).toBeNull();
    expect(screen.queryByTestId("client-errors-list")).toBeNull();
  });

  it("says there is nothing to report, and does not claim a failure", () => {
    render(<ClientErrorsPanel groups={[]} />);
    expect(screen.getByTestId("client-errors-none")).toHaveTextContent(
      "No front-end errors in the last 7 days.",
    );
    expect(screen.queryByTestId("client-errors-unknown")).toBeNull();
    expect(screen.queryByTestId("client-errors-list")).toBeNull();
  });

  it("renders two different things for 'could not read' and 'nothing wrong'", () => {
    // These are opposite facts. If a later edit collapses them into one branch —
    // `!groups?.length` is the whole distance — a broken monitor reads as all
    // clear, and nobody looks again.
    const unknown = render(<ClientErrorsPanel groups={null} />);
    const unknownText = unknown.container.textContent ?? "";
    unknown.unmount();

    const empty = render(<ClientErrorsPanel groups={[]} />);
    const emptyText = empty.container.textContent ?? "";

    expect(unknownText).not.toEqual(emptyText);
    expect(unknownText).not.toMatch(/no front-end errors/i);
    expect(emptyText).not.toMatch(/could not be read/i);
  });

  // ── what a list actually has to carry ──────────────────────────────────────

  it("renders one entry per group, with its message, route and count", () => {
    render(<ClientErrorsPanel groups={[STRUCTURAL, BURST, QUIET]} />);

    const rows = within(screen.getByTestId("client-errors-list")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const structural = rowFor(STRUCTURAL.message);
    expect(structural).toHaveTextContent("/app/leave/requests");
    expect(structural).toHaveTextContent("12×");

    const burst = rowFor(BURST.message);
    expect(burst).toHaveTextContent("/app/team");
    expect(burst).toHaveTextContent("247×");
  });

  it("names the missing route rather than leaving a gap", () => {
    // `route` is nullable and the RPC really does return null for errors thrown
    // outside a matched route. A blank there reads as a rendering fault.
    render(<ClientErrorsPanel groups={[QUIET]} />);
    expect(rowFor(QUIET.message)).toHaveTextContent("unknown route");
  });

  it("puts the occurrence count in the badge's text, not only in its colour", () => {
    // DESIGN_SYSTEM §3: colour is never the only signal. An admin who cannot
    // separate red from amber must still be able to read "247×".
    render(<ClientErrorsPanel groups={[BURST]} />);
    const badge = rowFor(BURST.message).querySelector("[data-tone]");
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("247×");
    expect((badge?.textContent ?? "").replace(/\D/g, "")).toBe("247");
  });

  // ── tone ───────────────────────────────────────────────────────────────────

  it("treats a fault seen across days as graver than a single-day burst", () => {
    // 12 hits over 4 days is something structural nobody has noticed. 247 hits
    // in one afternoon is one bad deploy. Ranking these the other way round —
    // or by count alone — sends somebody to the loud one first.
    render(<ClientErrorsPanel groups={[STRUCTURAL, BURST]} />);

    expect(toneOf(STRUCTURAL.message)).toBe("destructive");
    expect(toneOf(BURST.message)).toBe("warning");
    expect(SEVERITY_RANK[toneOf(STRUCTURAL.message)]).toBeGreaterThan(
      SEVERITY_RANK[toneOf(BURST.message)],
    );
  });

  it("escalates at the stated thresholds and not before", () => {
    // The boundaries themselves: 3 days is grave, 2 days is not; 10 occurrences
    // warn, 9 do not. Off-by-one here is invisible in review.
    const at = (daysSeen: number, occurrences: number, fingerprint: string) => ({
      ...QUIET,
      fingerprint,
      message: `boundary ${fingerprint}`,
      daysSeen,
      occurrences,
    });

    render(
      <ClientErrorsPanel
        groups={[at(3, 1, "d3"), at(2, 9, "d2"), at(1, 10, "o10"), at(1, 9, "o9")]}
      />,
    );

    expect(toneOf("boundary d3")).toBe("destructive");
    expect(toneOf("boundary d2")).toBe("neutral");
    expect(toneOf("boundary o10")).toBe("warning");
    expect(toneOf("boundary o9")).toBe("neutral");
  });

  // ── the trace ──────────────────────────────────────────────────────────────

  it("offers no trace button for a group that has no stack", () => {
    render(<ClientErrorsPanel groups={[BURST]} />);
    expect(within(rowFor(BURST.message)).queryByRole("button", { name: /trace/i })).toBeNull();
  });

  it("toggles the trace open and closed, and says so in aria-expanded", async () => {
    const user = userEvent.setup();
    render(<ClientErrorsPanel groups={[STRUCTURAL]} />);

    const button = within(rowFor(STRUCTURAL.message)).getByRole("button", { name: "Show trace" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId(`client-error-stack-${STRUCTURAL.fingerprint}`)).toBeNull();

    await user.click(button);

    const trace = screen.getByTestId(`client-error-stack-${STRUCTURAL.fingerprint}`);
    expect(trace).toHaveTextContent("at LeaveRequestsRoute");
    expect(
      within(rowFor(STRUCTURAL.message)).getByRole("button", { name: "Hide trace" }),
    ).toHaveAttribute("aria-expanded", "true");

    await user.click(
      within(rowFor(STRUCTURAL.message)).getByRole("button", { name: "Hide trace" }),
    );

    expect(screen.queryByTestId(`client-error-stack-${STRUCTURAL.fingerprint}`)).toBeNull();
    expect(
      within(rowFor(STRUCTURAL.message)).getByRole("button", { name: "Show trace" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens one trace at a time", () => {
    // Two groups, two buttons, one `expanded` string. Both closed to start with;
    // this pins that neither is open before anyone clicks, so the toggle test
    // above is measuring a click rather than an initial state.
    render(<ClientErrorsPanel groups={[STRUCTURAL, { ...STRUCTURAL, fingerprint: "second" }]} />);
    const buttons = screen.getAllByRole("button", { name: "Show trace" });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toHaveAttribute("aria-expanded", "false");
  });

  // ── D42 ────────────────────────────────────────────────────────────────────

  it("displays no organisation, even when the data carries one", () => {
    // D42: which customer hit a bug is tenant data. The RPC does not return it
    // today — so the guard that matters is against the day it does. These fields
    // are planted on the group; if a later edit renders an org column, the
    // planted values land on screen and this fails by name.
    const withTenantFields = {
      ...STRUCTURAL,
      organizationId: "org_9f3c1d44",
      organization_id: "org_9f3c1d44",
      organizationName: "Kirin Manufacturing Pte Ltd",
      orgSlug: "kirin-manufacturing",
      userEmail: "priya.raman@kirin-mfg.example",
    } as unknown as ClientErrorGroup;

    const { container } = render(<ClientErrorsPanel groups={[withTenantFields, BURST]} />);
    const text = container.textContent ?? "";

    for (const secret of [
      "org_9f3c1d44",
      "Kirin Manufacturing Pte Ltd",
      "kirin-manufacturing",
      "priya.raman@kirin-mfg.example",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("carries no organisation label or column anywhere in the panel", () => {
    // The other half: a heading, an empty cell, a "—" under "Organisation".
    // BURST's own text is free of these words, so a hit here is the component's.
    const { container } = render(<ClientErrorsPanel groups={[BURST]} />);
    expect(container.textContent ?? "").not.toMatch(
      /organi[sz]ation|\btenant\b|\bcustomer\b|\bworkspace\b|\bcompany\b/i,
    );
  });
});

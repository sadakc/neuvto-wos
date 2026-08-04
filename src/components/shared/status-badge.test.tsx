// @vitest-environment happy-dom

/**
 * What a status badge promises.
 *
 * Before 4 Aug 2026 every leave status rendered as the same grey text, so
 * "approved", "declined" and "still waiting" were visually identical and the
 * only way to tell them apart was to read every row. The badge fixes that with
 * colour — which introduces a new way to be wrong.
 *
 * These pin the two rules that make colour safe to rely on: the label is always
 * there, and the tone for a given status is the same on every screen.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";
import { LEAVE_CALENDAR_TONE, LEAVE_STATUS_LABEL, LEAVE_STATUS_TONE } from "@/modules/leave/status";
import { LEAVE_STATUSES } from "@/modules/leave/contracts";

describe("colour is never the only signal", () => {
  it.each(LEAVE_STATUSES)("%s renders its label as text", (status) => {
    // Around one in twelve men has a colour vision deficiency, and red/green is
    // the common axis — which is exactly the declined/approved axis here. A
    // badge that says nothing is unreadable to them, and to anyone printing in
    // greyscale.
    render(
      <StatusBadge tone={LEAVE_STATUS_TONE[status]}>{LEAVE_STATUS_LABEL[status]}</StatusBadge>,
    );
    expect(screen.getByText(LEAVE_STATUS_LABEL[status])).toBeInTheDocument();
  });

  it("every status has a distinct, human label", () => {
    const labels = LEAVE_STATUSES.map((s) => LEAVE_STATUS_LABEL[s]);
    expect(new Set(labels).size, `duplicate labels: ${labels.join(", ")}`).toBe(labels.length);
    // Not the raw database value. `pending_approval` is a column, not a
    // sentence somebody should have to read.
    for (const label of labels) expect(label).not.toMatch(/_/);
  });

  it("says Declined rather than Rejected", () => {
    // The column will keep saying `rejected`. A person reading that their leave
    // was *rejected* hears something harsher than the manager who picked "not
    // that week" meant.
    expect(LEAVE_STATUS_LABEL.rejected).toBe("Declined");
  });
});

describe("the tone mapping is fixed", () => {
  // Improvising per screen — amber here, grey there — teaches people to ignore
  // the colour, which costs more than never having added it.
  it("maps each status to the tone the design system specifies", () => {
    expect(LEAVE_STATUS_TONE).toEqual({
      draft: "neutral",
      pending_approval: "warning",
      approved: "success",
      rejected: "destructive",
      cancelled: "neutral",
    });
  });

  it("covers every status the database can produce", () => {
    // A status added to the enum without a tone renders `undefined` classes —
    // an unstyled badge, which looks like a styling glitch rather than a gap.
    for (const status of LEAVE_STATUSES) {
      expect(LEAVE_STATUS_TONE[status], `${status} has no tone`).toBeTruthy();
      expect(LEAVE_STATUS_LABEL[status], `${status} has no label`).toBeTruthy();
    }
  });

  it("keeps the calendar's deliberate disagreement with the list", () => {
    // An approved request is a GREEN badge in a list and a BLUE cell in the
    // calendar. Green on a calendar grid reads as "this day is free", which is
    // the opposite of what an approved absence means; blue reads as "booked".
    // Documented in `06` §Leave Calendar — this is not a bug to tidy up.
    expect(LEAVE_STATUS_TONE.approved).toBe("success");
    expect(LEAVE_CALENDAR_TONE.approved).toBe("info");
    // ...and it disagrees about that ONE status and nothing else.
    for (const status of LEAVE_STATUSES) {
      if (status === "approved") continue;
      expect(LEAVE_CALENDAR_TONE[status], `calendar diverges on ${status}`).toBe(
        LEAVE_STATUS_TONE[status],
      );
    }
  });
});

describe("emphasis", () => {
  it("defaults to the tinted fill, not the solid one", () => {
    // Thirty leave requests rendered in solid amber and green is a fruit salad
    // nobody can scan. Solid is for the one status that is the point of the
    // page.
    const { container } = render(<StatusBadge tone="warning">Awaiting approval</StatusBadge>);
    const badge = container.querySelector("[data-tone]");
    expect(badge?.className).toContain("bg-warning-muted");
    expect(badge?.className).not.toContain("bg-warning ");
  });

  it("uses the paired foreground on a solid fill", () => {
    // A solid fill with body-coloured text is the contrast bug this pairing
    // exists to prevent; tokens.test.ts proves each pair meets AA.
    const { container } = render(
      <StatusBadge tone="warning" emphasis="solid">
        Awaiting approval
      </StatusBadge>,
    );
    const badge = container.querySelector("[data-tone]");
    expect(badge?.className).toContain("bg-warning");
    expect(badge?.className).toContain("text-warning-foreground");
  });
});

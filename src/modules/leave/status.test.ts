/**
 * How Leave names and colours its own statuses.
 *
 * Lives inside the module because "pending_approval" is Leave's vocabulary, not
 * the platform's — the first draft of this put it in `components/shared` and CI
 * refused it, because a shared file naming a module means deleting the module
 * breaks the build.
 *
 * Before 4 Aug 2026 every status rendered as identical grey text: approved,
 * declined and still-waiting were indistinguishable at a glance, and the only
 * way to tell them apart was to read each row. These pin the rules that make
 * the colour worth trusting now that there is one.
 */

import { describe, expect, it } from "vitest";
import { LEAVE_CALENDAR_TONE, LEAVE_STATUS_LABEL, LEAVE_STATUS_TONE } from "./status";
import { LEAVE_STATUSES } from "./contracts";

describe("labels", () => {
  it("every status has a distinct, human label", () => {
    const labels = LEAVE_STATUSES.map((s) => LEAVE_STATUS_LABEL[s]);
    expect(new Set(labels).size, `duplicate labels: ${labels.join(", ")}`).toBe(labels.length);
    // Not the raw database value. `pending_approval` is a column name, not a
    // sentence anybody should have to read off a screen.
    for (const label of labels) expect(label).not.toMatch(/_/);
  });

  it("says Declined rather than Rejected", () => {
    // The column will keep saying `rejected`. Somebody reading that their leave
    // was *rejected* hears something harsher than the manager who picked "no,
    // not that week" meant, and there is no reason to make a routine
    // scheduling answer feel personal.
    expect(LEAVE_STATUS_LABEL.rejected).toBe("Declined");
  });
});

describe("the tone mapping is fixed", () => {
  // Improvising per screen — amber here, grey there — teaches people to ignore
  // the colour, which costs more than never having added it.
  it("matches the mapping the design system specifies", () => {
    expect(LEAVE_STATUS_TONE).toEqual({
      draft: "neutral",
      pending_approval: "warning",
      approved: "success",
      rejected: "destructive",
      cancelled: "neutral",
    });
  });

  it("covers every status the database can produce", () => {
    // A status added to the enum without a tone renders an unstyled badge,
    // which looks like a glitch rather than a gap.
    for (const status of LEAVE_STATUSES) {
      expect(LEAVE_STATUS_TONE[status], `${status} has no tone`).toBeTruthy();
      expect(LEAVE_STATUS_LABEL[status], `${status} has no label`).toBeTruthy();
    }
  });

  it("keeps the calendar's deliberate disagreement with the list", () => {
    // An approved request is a GREEN badge in a list and a BLUE cell in the
    // calendar. Green on a calendar grid reads as "this day is free" — the
    // opposite of what an approved absence means — while blue reads as
    // "booked". From `06` §Leave Calendar; not a bug to tidy up.
    expect(LEAVE_STATUS_TONE.approved).toBe("success");
    expect(LEAVE_CALENDAR_TONE.approved).toBe("info");
  });

  it("disagrees about that one status and nothing else", () => {
    for (const status of LEAVE_STATUSES) {
      if (status === "approved") continue;
      expect(LEAVE_CALENDAR_TONE[status], `calendar diverges on ${status}`).toBe(
        LEAVE_STATUS_TONE[status],
      );
    }
  });
});

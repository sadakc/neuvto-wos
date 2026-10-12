// @vitest-environment happy-dom

/**
 * The carry-forward review (D91), as the Leave Admin meets it. What it pins:
 *
 * - it opens on the year just ended, and offers to prepare it when it has not
 *   been;
 * - each line says what the person has left and what the rule proposes; the
 *   Admin's own number is sent, and the rule's number can be put back;
 * - locking says, before it happens, how many people and which year, and
 *   happens only on confirmation;
 * - it cannot be locked before next year opens, and says why;
 * - a locked review says who locked it and offers nothing to change.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getCarryYears: vi.fn(),
  getCarryReview: vi.fn(),
  prepareCarry: vi.fn(),
  adjustCarry: vi.fn(),
  lockCarry: vi.fn(),
}));
vi.mock("../handlers", () => h);

import CarryForwardReview from "./CarryForwardReview";

const draft = {
  id: "rv1",
  fromFy: "2025-26",
  toFy: "2026-27",
  status: "draft" as const,
  preparedAt: "2026-04-02T09:00:00Z",
  lockedAt: null,
  lockedBy: null,
  nextYearOpen: true,
  lines: [
    {
      id: "l1",
      employeeName: "Ravi Employee",
      leaveTypeName: "Casual",
      availableDays: 8,
      proposedDays: 5,
      adjustedDays: null,
      carryForwardMax: 5,
    },
    {
      id: "l2",
      employeeName: "Priya Employee",
      leaveTypeName: "Casual",
      availableDays: 2,
      proposedDays: 2,
      adjustedDays: 1,
      carryForwardMax: 5,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  h.getCarryYears.mockResolvedValue({ current: "2026-27", previous: "2025-26" });
  h.getCarryReview.mockResolvedValue(draft);
  h.prepareCarry.mockResolvedValue("rv1");
  h.adjustCarry.mockResolvedValue(undefined);
  h.lockCarry.mockResolvedValue(2);
});

const lineFor = async (name: string) =>
  (await screen.findByText(name)).closest('[data-testid="carry-line"]') as HTMLElement;

describe("the carry-forward review", () => {
  it("opens on the year just ended, and offers to prepare it", async () => {
    const user = userEvent.setup();
    h.getCarryReview.mockResolvedValueOnce(null);
    render(<CarryForwardReview />);
    expect(await screen.findByText("2025-26 hasn't been reviewed yet.")).toBeInTheDocument();
    expect(h.getCarryReview).toHaveBeenCalledWith("2025-26");
    await user.click(screen.getByRole("button", { name: "Prepare the review" }));
    expect(h.prepareCarry).toHaveBeenCalledWith("2025-26");
    expect(await lineFor("Ravi Employee")).toBeInTheDocument();
  });

  it("says what each person has left and what the rule proposes, and marks a changed line", async () => {
    render(<CarryForwardReview />);
    const ravi = await lineFor("Ravi Employee");
    expect(ravi).toHaveTextContent("Casual · 8 left · the rule carries 5 (up to 5)");
    expect(within(ravi).getByLabelText("Days to carry for Ravi Employee, Casual")).toHaveValue(5);
    const priya = await lineFor("Priya Employee");
    expect(priya).toHaveTextContent("Changed from 2");
    expect(within(priya).getByLabelText("Days to carry for Priya Employee, Casual")).toHaveValue(1);
  });

  it("sends the Admin's number, and puts the rule's back", async () => {
    const user = userEvent.setup();
    render(<CarryForwardReview />);
    const ravi = await lineFor("Ravi Employee");
    const input = within(ravi).getByLabelText("Days to carry for Ravi Employee, Casual");
    await user.clear(input);
    await user.type(input, "7");
    await user.click(within(ravi).getByRole("button", { name: "Save" }));
    expect(h.adjustCarry).toHaveBeenCalledWith("l1", 7);
    await user.click(
      within(await lineFor("Priya Employee")).getByRole("button", { name: "Use the rule's 2" }),
    );
    expect(h.adjustCarry).toHaveBeenCalledWith("l2", null);
  });

  it("says what locking does, and locks only on confirmation", async () => {
    const user = userEvent.setup();
    render(<CarryForwardReview />);
    await user.click(await screen.findByRole("button", { name: "Lock and apply to 2026-27" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "This sets the carried-over days of 2 people in 2026-27, 6 days in all. A locked review can't be changed.",
    );
    expect(h.lockCarry).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Lock the review" }));
    expect(h.lockCarry).toHaveBeenCalledWith("rv1");
  });

  it("cannot be locked before next year opens, and says why", async () => {
    h.getCarryReview.mockResolvedValue({ ...draft, nextYearOpen: false });
    render(<CarryForwardReview />);
    expect(await screen.findByRole("button", { name: "Lock and apply to 2026-27" })).toBeDisabled();
    expect(
      screen.getByText("2026-27 isn't open yet. You can lock this once it opens."),
    ).toBeInTheDocument();
  });

  it("shows a locked review as final", async () => {
    h.getCarryReview.mockResolvedValue({
      ...draft,
      status: "locked",
      lockedAt: "2026-04-03T09:00:00Z",
      lockedBy: "Mark Manager",
    });
    render(<CarryForwardReview />);
    expect(await screen.findByText(/Locked by Mark Manager/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock and apply/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("reviews this year too", async () => {
    const user = userEvent.setup();
    render(<CarryForwardReview />);
    await screen.findByText("Ravi Employee");
    await user.click(screen.getByRole("radio", { name: "2026-27" }));
    expect(h.getCarryReview).toHaveBeenLastCalledWith("2026-27");
  });
});

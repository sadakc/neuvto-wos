// @vitest-environment happy-dom

/**
 * Claiming compensatory off (D89), as the person meets it. What it pins:
 *
 * - any number of days worked, each a full day or a half, can be listed, and
 *   exactly those are sent with the reason and any proof;
 * - the type's rules are said before sending: proof needed, how far back;
 * - nothing is promised: the notice says it waits for approval;
 * - a refusal is said in words;
 * - each claim shows its days, its state and, once approved, when it expires;
 *   a waiting one can be withdrawn;
 * - a company without compensatory off says so instead of showing a form.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  getLeaveTypes: vi.fn(),
  getMyBalances: vi.fn(),
  getMyCompOffClaims: vi.fn(),
  submitCompOff: vi.fn(),
  cancelCompOff: vi.fn(),
}));
vi.mock("../handlers", () => h);

import CompOff from "./CompOff";

const TYPE = {
  id: "coff",
  name: "Comp off",
  kind: "earned" as const,
  earnedClaimWithinDays: 30,
  earnedProofRequired: false,
  earnedExpiresAfterDays: 90,
};

beforeEach(() => {
  vi.resetAllMocks();
  h.getLeaveTypes.mockResolvedValue([{ id: "casual", name: "Casual", kind: "paid" }, TYPE]);
  h.getMyBalances.mockResolvedValue([
    {
      leaveTypeId: "coff",
      leaveTypeName: "Comp off",
      fyLabel: "2026-27",
      entitledDays: 2,
      carryforwardDays: 0,
      usedDays: 0,
      reservedDays: 0,
      pendingDays: 0,
      availableDays: 2,
    },
  ]);
  h.getMyCompOffClaims.mockResolvedValue([
    {
      claimId: "c1",
      leaveTypeId: "coff",
      leaveTypeName: "Comp off",
      reason: "Audit weekend",
      totalDays: 1.5,
      status: "approved",
      hasProof: false,
      submittedAt: "2026-10-01T09:00:00Z",
      decidedAt: "2026-10-02T09:00:00Z",
      expiresOn: "2026-12-31",
      expiredDays: 0,
      days: [
        { date: "2026-09-27", days: 1, note: null },
        { date: "2026-09-28", days: 0.5, note: null },
      ],
    },
    {
      claimId: "c2",
      leaveTypeId: "coff",
      leaveTypeName: "Comp off",
      reason: "Night shift cover",
      totalDays: 1,
      status: "pending_approval",
      hasProof: true,
      submittedAt: "2026-10-10T09:00:00Z",
      decidedAt: null,
      expiresOn: null,
      expiredDays: 0,
      days: [{ date: "2026-10-09", days: 1, note: "Covered Arun" }],
    },
  ]);
  h.submitCompOff.mockResolvedValue("c3");
  h.cancelCompOff.mockResolvedValue(undefined);
});

describe("claiming compensatory off", () => {
  it("sends every day listed, each full or half, with the reason", async () => {
    const user = userEvent.setup();
    render(<CompOff />);
    const day1 = await screen.findByLabelText("Day worked 1");
    await user.type(day1, "2026-10-04");
    await user.click(screen.getByRole("button", { name: "Add another day" }));
    await user.type(screen.getByLabelText("Day worked 2"), "2026-10-05");
    await user.selectOptions(screen.getByLabelText("How much of day 2"), "0.5");
    await user.type(screen.getByLabelText("Note for day 2"), "Stock count");
    await user.type(screen.getByLabelText("Why you're owed this"), "Weekend stock count");
    await user.click(screen.getByRole("button", { name: "Send for approval" }));

    expect(h.submitCompOff).toHaveBeenCalledWith({
      leaveTypeId: "coff",
      days: [
        { date: "2026-10-04", days: 1, note: "" },
        { date: "2026-10-05", days: 0.5, note: "Stock count" },
      ],
      reason: "Weekend stock count",
      proof: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sent for approval: 1.5 days. Nothing is credited until it's approved.",
    );
  });

  it("removes a listed day", async () => {
    const user = userEvent.setup();
    render(<CompOff />);
    await user.type(await screen.findByLabelText("Day worked 1"), "2026-10-04");
    await user.click(screen.getByRole("button", { name: "Add another day" }));
    await user.type(screen.getByLabelText("Day worked 2"), "2026-10-05");
    await user.click(screen.getByRole("button", { name: "Remove day 1" }));
    await user.type(screen.getByLabelText("Why you're owed this"), "Weekend");
    await user.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(h.submitCompOff).toHaveBeenCalledWith(
      expect.objectContaining({ days: [{ date: "2026-10-05", days: 1, note: "" }] }),
    );
  });

  it("says the type's rules, and asks for proof when the type needs it", async () => {
    h.getLeaveTypes.mockResolvedValue([{ ...TYPE, earnedProofRequired: true }]);
    render(<CompOff />);
    expect(await screen.findByTestId("comp-off-rules")).toHaveTextContent(
      "Claim within 30 days of the day worked. Proof is needed. Credited days expire 90 days after approval.",
    );
    expect(screen.getByLabelText("Proof (needed)")).toBeInTheDocument();
  });

  it("says a refusal in words", async () => {
    const user = userEvent.setup();
    h.submitCompOff.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "You've already claimed one of those days.", 400),
    );
    render(<CompOff />);
    await user.type(await screen.findByLabelText("Day worked 1"), "2026-10-04");
    await user.type(screen.getByLabelText("Why you're owed this"), "Weekend");
    await user.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've already claimed one of those days.",
    );
  });
});

describe("my claims", () => {
  it("shows each claim's days, state and expiry, and withdraws a waiting one", async () => {
    const user = userEvent.setup();
    render(<CompOff />);
    const claims = await screen.findAllByTestId("comp-off-claim");
    expect(claims[0]).toHaveTextContent("1.5 days · 27 Sep 2026 (full), 28 Sep 2026 (half)");
    expect(claims[0]).toHaveTextContent("Approved · expires 31 Dec 2026");
    expect(within(claims[0]).queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(claims[1]).toHaveTextContent("Waiting for approval");
    await user.click(within(claims[1]).getByRole("button", { name: "Withdraw" }));
    expect(h.cancelCompOff).toHaveBeenCalledWith("c2");
  });

  it("shows what is available to book", async () => {
    render(<CompOff />);
    expect(await screen.findByTestId("comp-off-available")).toHaveTextContent(
      "2 days of Comp off to book",
    );
  });
});

describe("a company without compensatory off", () => {
  it("says so instead of showing a form", async () => {
    h.getLeaveTypes.mockResolvedValue([{ id: "casual", name: "Casual", kind: "paid" }]);
    h.getMyCompOffClaims.mockResolvedValue([]);
    render(<CompOff />);
    expect(
      await screen.findByText("Your company doesn't offer compensatory off."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for approval" })).toBeNull();
  });
});

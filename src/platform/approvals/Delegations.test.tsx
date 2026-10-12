// @vitest-environment happy-dom

/**
 * Handing approvals over while away (D92), as an approver meets it. What it
 * pins:
 *
 * - what is in place is said both ways: whose approvals go where, and whose
 *   come to you, with the dates, the scope and whether it is in force now;
 * - only the one who gave it (or an admin) is offered to cancel it;
 * - a new hand-over sends exactly who, when and which approvals, and says
 *   what will happen;
 * - only a company admin is offered to hand over somebody else's;
 * - a refusal is said in words.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  listMyDelegations: vi.fn(),
  listDelegateCandidates: vi.fn(),
  delegateApprovals: vi.fn(),
  cancelDelegation: vi.fn(),
}));
vi.mock("./index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index")>()),
  ...h,
}));

import { Delegations } from "./Delegations";

const MODULES = [
  { key: "leave", name: "Leave Management" },
  { key: "employee", name: "Employee Master" },
];

beforeEach(() => {
  vi.resetAllMocks();
  h.listMyDelegations.mockResolvedValue([
    {
      id: "d1",
      direction: "given",
      delegatorName: "Mark Manager",
      delegateName: "Hema HR",
      fromDate: "2026-10-12",
      toDate: "2026-10-19",
      moduleKey: "leave",
      moduleName: "Leave Management",
      reason: "On leave",
      inForce: true,
    },
    {
      id: "d2",
      direction: "received",
      delegatorName: "Dan Director",
      delegateName: "Mark Manager",
      fromDate: "2026-10-20",
      toDate: "2026-10-22",
      moduleKey: null,
      moduleName: null,
      reason: null,
      inForce: false,
    },
  ]);
  h.listDelegateCandidates.mockResolvedValue([
    { id: "hema", fullName: "Hema HR" },
    { id: "dan", fullName: "Dan Director" },
  ]);
  h.delegateApprovals.mockResolvedValue("d3");
  h.cancelDelegation.mockResolvedValue(undefined);
});

const rowFor = async (text: RegExp) =>
  (await screen.findByText(text)).closest('[data-testid="delegation"]') as HTMLElement;

describe("handing approvals over", () => {
  it("says what is in place both ways, and offers to cancel only what you gave", async () => {
    render(<Delegations isAdmin={false} modules={MODULES} />);
    const given = await rowFor(/Your approvals go to Hema HR/);
    expect(given).toHaveTextContent(
      "Your approvals go to Hema HR · 12 Oct 2026 to 19 Oct 2026 · Leave Management only · in force now",
    );
    const received = await rowFor(/Dan Director's approvals come to you/);
    expect(received).toHaveTextContent(
      "Dan Director's approvals come to you · 20 Oct 2026 to 22 Oct 2026 · all of them · from 20 Oct 2026",
    );
    expect(within(received).queryByRole("button", { name: "Cancel" })).toBeNull();
    await userEvent.setup().click(within(given).getByRole("button", { name: "Cancel" }));
    expect(h.cancelDelegation).toHaveBeenCalledWith("d1");
  });

  it("sends exactly who, when and which approvals, and says what will happen", async () => {
    const user = userEvent.setup();
    render(<Delegations isAdmin={false} modules={MODULES} />);
    await user.selectOptions(await screen.findByLabelText("Hand them to"), "dan");
    await user.type(screen.getByLabelText("From"), "2026-11-02");
    await user.type(screen.getByLabelText("To"), "2026-11-06");
    await user.selectOptions(screen.getByLabelText("Which approvals"), "leave");
    await user.type(screen.getByLabelText("Reason (optional)"), "Travelling");
    expect(screen.queryByLabelText("Whose approvals")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hand over" }));
    expect(h.delegateApprovals).toHaveBeenCalledWith({
      delegateId: "dan",
      fromDate: "2026-11-02",
      toDate: "2026-11-06",
      moduleKey: "leave",
      reason: "Travelling",
      delegatorId: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Dan Director will see and can decide your Leave Management approvals from 2 Nov 2026 to 6 Nov 2026. You still can too.",
    );
  });

  it("lets a company admin hand over somebody else's approvals", async () => {
    const user = userEvent.setup();
    render(<Delegations isAdmin modules={MODULES} />);
    await user.selectOptions(await screen.findByLabelText("Whose approvals"), "hema");
    await user.selectOptions(screen.getByLabelText("Hand them to"), "dan");
    await user.type(screen.getByLabelText("From"), "2026-11-02");
    await user.type(screen.getByLabelText("To"), "2026-11-03");
    await user.click(screen.getByRole("button", { name: "Hand over" }));
    expect(h.delegateApprovals).toHaveBeenCalledWith(
      expect.objectContaining({ delegatorId: "hema", delegateId: "dan", moduleKey: null }),
    );
  });

  it("says a refusal in words", async () => {
    const user = userEvent.setup();
    h.delegateApprovals.mockRejectedValue(
      new AppError(
        "VALIDATION_FAILED",
        "Your approvals are already handed over for some of those dates.",
        400,
      ),
    );
    render(<Delegations isAdmin={false} modules={MODULES} />);
    await user.selectOptions(await screen.findByLabelText("Hand them to"), "dan");
    await user.type(screen.getByLabelText("From"), "2026-11-02");
    await user.type(screen.getByLabelText("To"), "2026-11-03");
    await user.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your approvals are already handed over for some of those dates.",
    );
  });
});

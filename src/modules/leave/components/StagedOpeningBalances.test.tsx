// @vitest-environment happy-dom

/**
 * Opening balances for people who have not joined yet (D88). What it pins:
 *
 * - everybody not yet joined is listed against each paid type, as a draft or
 *   invited, with what their joining date would entitle them to;
 * - saving stages exactly what was typed against their employee record, and
 *   says it applies when they accept;
 * - a refusal is said in words;
 * - a staged number that could not be applied when they joined is listed,
 *   with what to do about it.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  getStagedOpeningBalances: vi.fn(),
  stageOpeningBalance: vi.fn(),
  getStagedOpeningProblems: vi.fn(),
}));
vi.mock("../handlers", () => h);

import StagedOpeningBalances from "./StagedOpeningBalances";

const nisha = {
  employeeRecordId: "e1",
  employeeName: "Nisha Rao",
  employeeCode: "E-101",
  stage: "draft" as const,
  joinedDate: "2026-11-01",
  leaveTypeId: "casual",
  leaveTypeName: "Casual",
  entitledDays: 5,
  usedDays: 0,
  carryforwardDays: 0,
  staged: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  h.getStagedOpeningBalances.mockResolvedValue([
    nisha,
    {
      ...nisha,
      employeeRecordId: "e2",
      employeeName: "Kiran",
      employeeCode: null,
      stage: "invited",
      joinedDate: null,
      entitledDays: 12,
      usedDays: 2,
      carryforwardDays: 1,
      staged: true,
    },
  ]);
  h.getStagedOpeningProblems.mockResolvedValue([]);
  h.stageOpeningBalance.mockResolvedValue(undefined);
});

const rowFor = async (name: string) =>
  (await screen.findByText(name)).closest('[data-testid="staged-row"]') as HTMLElement;

describe("people not yet joined", () => {
  it("lists them with their stage and what their joining date entitles them to", async () => {
    render(<StagedOpeningBalances />);
    const n = await rowFor("Nisha Rao");
    expect(n).toHaveTextContent("Draft · E-101 · joins 2026-11-01");
    expect(n).toHaveTextContent("Casual · 5 days from their joining date");
    const k = await rowFor("Kiran");
    expect(k).toHaveTextContent("Invited · no joining date yet");
    expect(k).toHaveTextContent("Casual · 12 days for a full year");
    expect(k).toHaveTextContent("Waiting for them");
    expect(n).not.toHaveTextContent("Waiting for them");
  });

  it("stages what was typed, against their record, and says when it applies", async () => {
    const user = userEvent.setup();
    render(<StagedOpeningBalances />);
    const n = await rowFor("Nisha Rao");
    await user.clear(within(n).getByLabelText("Already taken this year"));
    await user.type(within(n).getByLabelText("Already taken this year"), "2.5");
    await user.clear(within(n).getByLabelText("Carried over from last year"));
    await user.type(within(n).getByLabelText("Carried over from last year"), "1");
    await user.click(within(n).getByRole("button", { name: "Save" }));
    expect(h.stageOpeningBalance).toHaveBeenCalledWith("e1", "casual", 2.5, 1);
    expect(await screen.findByTestId("staged-notice")).toHaveTextContent(
      "Nisha Rao · Casual saved. It applies when they accept their invitation.",
    );
  });

  it("says a refusal in words", async () => {
    const user = userEvent.setup();
    h.stageOpeningBalance.mockRejectedValue(
      new AppError(
        "VALIDATION_FAILED",
        "That is more than their joining date entitles them to.",
        400,
      ),
    );
    render(<StagedOpeningBalances />);
    await user.click(within(await rowFor("Nisha Rao")).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is more than their joining date entitles them to.",
    );
  });

  it("lists what could not be applied when they joined, and what to do", async () => {
    h.getStagedOpeningProblems.mockResolvedValue([
      {
        employeeId: "p9",
        employeeName: "Arun",
        leaveTypeName: "Casual",
        usedDays: 12,
        carryforwardDays: 0,
        problem: "OPENING_BALANCE_OVERDRAWN",
      },
    ]);
    render(<StagedOpeningBalances />);
    expect(await screen.findByTestId("staged-problems")).toHaveTextContent(
      "Arun · Casual: 12 days taken was more than they are entitled to once they joined, so nothing was applied. Set their balance above.",
    );
  });

  it("says so when everybody has joined", async () => {
    h.getStagedOpeningBalances.mockResolvedValue([]);
    render(<StagedOpeningBalances />);
    expect(
      await screen.findByText("Everybody has joined. Nobody is waiting for an opening balance."),
    ).toBeInTheDocument();
  });
});

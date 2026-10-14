// @vitest-environment happy-dom

/**
 * Blackout periods, as the Leave Admin configures them (Leave phase 2). What it
 * pins:
 *
 * - the list says each period's name and dates;
 * - adding sends a name and dates, and refuses an end before the start
 *   without a round trip;
 * - removing asks first, says what it does and does not do, and only then
 *   removes.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getBlackouts: vi.fn(),
  saveBlackout: vi.fn(),
  removeBlackout: vi.fn(),
}));
vi.mock("../handlers", () => h);
vi.mock("@/platform/auth", () => ({
  getCurrentUser: async () => ({
    id: "alice",
    email: "alice@acme.test",
    fullName: "Alice",
    organizationId: "org",
    organizationName: "Acme",
    roles: ["org_admin"],
  }),
}));

import Blackouts from "./Blackouts";

beforeEach(() => {
  vi.resetAllMocks();
  h.getBlackouts.mockResolvedValue([
    { id: "b1", name: "Year-end audit", fromDate: "2099-03-23", toDate: "2099-03-27" },
  ]);
  h.saveBlackout.mockResolvedValue(undefined);
  h.removeBlackout.mockResolvedValue(undefined);
});

describe("blackout periods", () => {
  it("lists each period by name and dates", async () => {
    render(<Blackouts />);
    const row = await screen.findByTestId("blackout-row");
    expect(row).toHaveTextContent("Year-end audit");
    expect(row).toHaveTextContent("2099");
  });

  it("adds one, and refuses an end before the start without sending it", async () => {
    const user = userEvent.setup();
    render(<Blackouts />);
    await user.click(await screen.findByTestId("add-blackout"));
    await user.type(screen.getByLabelText("Name"), "Diwali rush");
    await user.type(screen.getByLabelText("From"), "10/11/2099");
    await user.type(screen.getByLabelText("To"), "01/11/2099");
    expect(screen.getByTestId("save-blackout")).toBeDisabled();
    expect(screen.getByTestId("blackout-dates-error")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "14/11/2099");
    await user.click(screen.getByTestId("save-blackout"));
    expect(h.saveBlackout).toHaveBeenCalledWith(
      { name: "Diwali rush", fromDate: "2099-11-10", toDate: "2099-11-14" },
      "org",
    );
    expect(h.getBlackouts).toHaveBeenCalledTimes(2);
  });

  it("asks before removing, says existing leave is untouched, and only then removes", async () => {
    const user = userEvent.setup();
    render(<Blackouts />);
    await user.click(within(await screen.findByTestId("blackout-row")).getByText("Remove"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Leave already applied for is not changed");
    expect(h.removeBlackout).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Remove blackout" }));
    expect(h.removeBlackout).toHaveBeenCalledWith("b1");
  });

  it("asks for a whole date and saves nothing while one is half typed", async () => {
    const user = userEvent.setup();
    render(<Blackouts />);
    await user.click(await screen.findByTestId("add-blackout"));
    await user.type(screen.getByLabelText("Name"), "Diwali rush");
    await user.type(screen.getByLabelText("From"), "10/11");
    await user.type(screen.getByLabelText("To"), "14/11/2099");
    expect(screen.getByTestId("blackout-date-problem")).toHaveTextContent("DD/MM/YYYY");
    expect(screen.getByTestId("save-blackout")).toBeDisabled();
  });
});

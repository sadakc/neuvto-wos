// @vitest-environment happy-dom

/**
 * "Request a change" (E7). What it pins:
 *
 * - only your own card offers it; an Admin's view of somebody does not;
 * - nothing is sent without a description, and sending says who was told and
 *   shows the request in your list straight away;
 * - an Admin cannot decline without saying why, and closing a request reloads
 *   the list so it leaves "Waiting";
 * - a refusal stays on the row it is about.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { ChangeRequest, EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  listChangeRequests: vi.fn(),
  requestChange: vi.fn(),
  resolveChange: vi.fn(),
  getRestrictedReads: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import ChangeRequestsScreen from "./ChangeRequests";
import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;

function request(id: string, status: ChangeRequest["status"] = "open"): ChangeRequest {
  return {
    id,
    employeeId: "e-1",
    employeeName: "Priya Employee",
    section: "address",
    details: "I moved to 9 Lake View, Hosur on 1 June.",
    status,
    resolutionNote: null,
    resolvedByName: null,
    resolvedAt: null,
    createdAt: "2026-10-12T09:00:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.listChangeRequests.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
});

describe("asking", () => {
  it("is offered on your own card only", () => {
    const { unmount } = render(<EmployeeCardView card={as("admin")} />);
    expect(screen.queryByTestId("request-change")).toBeNull();
    unmount();
    render(<EmployeeCardView card={as("colleague")} />);
    expect(screen.queryByTestId("request-change")).toBeNull();
  });

  it("needs a description, says who was told, and lists the request at once", async () => {
    const user = userEvent.setup();
    api.requestChange.mockResolvedValue(undefined);
    render(<EmployeeCardView card={as("self")} />);
    await user.click(screen.getByTestId("request-change"));
    expect(screen.getByTestId("request-send")).toBeDisabled();

    await user.selectOptions(screen.getByTestId("request-section"), "address");
    await user.type(screen.getByTestId("request-details"), "I moved to Hosur on 1 June.");
    api.listChangeRequests.mockResolvedValue([request("r-1")]);
    await user.click(screen.getByTestId("request-send"));

    expect(api.requestChange).toHaveBeenCalledWith(
      as("self").id,
      "address",
      "I moved to Hosur on 1 June.",
    );
    expect(await screen.findByTestId("request-sent")).toHaveTextContent("Sent to your HR admins.");
    expect(await screen.findByTestId("my-change-request")).toHaveTextContent("Waiting");
  });
});

describe("an Admin closing them", () => {
  it("will not decline without a reason", async () => {
    const user = userEvent.setup();
    api.listChangeRequests.mockResolvedValue([request("r-1")]);
    api.resolveChange.mockResolvedValue(undefined);
    render(<ChangeRequestsScreen />);
    await user.click(await screen.findByTestId("resolve-decline"));
    expect(screen.getByTestId("resolve-confirm")).toBeDisabled();
    await user.type(screen.getByTestId("resolve-note"), "No proof of address yet");
    await user.click(screen.getByTestId("resolve-confirm"));
    expect(api.resolveChange).toHaveBeenCalledWith("r-1", "declined", "No proof of address yet");
  });

  it("reloads after marking one made, so it leaves Waiting", async () => {
    const user = userEvent.setup();
    api.listChangeRequests.mockResolvedValueOnce([request("r-1")]).mockResolvedValueOnce([]);
    api.resolveChange.mockResolvedValue(undefined);
    render(<ChangeRequestsScreen />);
    await user.click(await screen.findByTestId("resolve-done"));
    await user.click(screen.getByTestId("resolve-confirm"));
    expect(api.resolveChange).toHaveBeenCalledWith("r-1", "done", "");
    expect(await screen.findByTestId("change-requests-empty")).toHaveTextContent("Nothing waiting");
    expect(api.listChangeRequests).toHaveBeenLastCalledWith("open");
  });

  it("keeps a refusal on the row it is about", async () => {
    const user = userEvent.setup();
    api.listChangeRequests.mockResolvedValue([request("r-1"), request("r-2")]);
    api.resolveChange.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "Somebody has already dealt with that request.", 400),
    );
    render(<ChangeRequestsScreen />);
    const [first, second] = await screen.findAllByTestId("change-request-row");
    await user.click(within(second).getByTestId("resolve-done"));
    await user.click(within(second).getByTestId("resolve-confirm"));
    expect(await within(second).findByTestId("resolve-error")).toHaveTextContent("already dealt");
    expect(within(first).queryByTestId("resolve-error")).toBeNull();
  });
});

// @vitest-environment happy-dom

/**
 * The bell (D111): a count of what is unread, a list newest first like
 * Teams, and a notice that opens the screen it is about and is marked read.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listNotices: vi.fn(),
  countUnread: vi.fn(),
  markRead: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("./feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./feed")>();
  return {
    ...actual,
    listNotices: h.listNotices,
    countUnread: h.countUnread,
    markRead: h.markRead,
  };
});
vi.mock("@/platform/modules", () => ({
  getNotificationLinks: async () => ({
    links: new Map([["employee.change_requested", () => "/app/employee/change-requests"]]),
    moduleOfEntity: new Map([["leave_request", "leave"]]),
    linksByModule: new Map(),
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));

import { NotificationBell } from "./NotificationBell";

const notice = (
  id: string,
  eventKey: string,
  subject: string,
  readAt: string | null,
  minsAgo: number,
) => ({
  id,
  eventKey,
  subject,
  payload: eventKey.startsWith("approval.") ? { entity_type: "leave_request" } : {},
  createdAt: new Date(Date.now() - minsAgo * 60000).toISOString(),
  readAt,
});

beforeEach(() => {
  vi.resetAllMocks();
  h.countUnread.mockResolvedValue(2);
  h.markRead.mockResolvedValue(undefined);
  h.listNotices.mockResolvedValue([
    notice(
      "n1",
      "employee.change_requested",
      "Ravi Employee asked for a change to their record",
      null,
      2,
    ),
    notice("n2", "approval.submitted", "Priya Employee has asked for leave", null, 30),
    notice("n3", "approval.completed", "Your leave was approved", "2026-10-13T10:00:00Z", 600),
  ]);
});

describe("the bell", () => {
  it("shows how many are unread", async () => {
    render(<NotificationBell />);
    expect(await screen.findByTestId("bell-count")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();
  });

  it("shows no count when everything is read, and caps a big one", async () => {
    h.countUnread.mockResolvedValue(0);
    const { unmount } = render(<NotificationBell />);
    await screen.findByRole("button", { name: "Notifications" });
    expect(screen.queryByTestId("bell-count")).toBeNull();
    unmount();
    h.countUnread.mockResolvedValue(42);
    render(<NotificationBell />);
    expect(await screen.findByTestId("bell-count")).toHaveTextContent("9+");
  });

  it("lists them newest first, the unread marked", async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: /Notifications/ }));
    const items = await screen.findAllByTestId("notice");
    expect(items.map((i) => within(i).getByTestId("notice-subject").textContent)).toEqual([
      "Ravi Employee asked for a change to their record",
      "Priya Employee has asked for leave",
      "Your leave was approved",
    ]);
    expect(items.map((i) => i.getAttribute("data-unread"))).toEqual(["true", "true", "false"]);
    expect(within(items[0]).getByText("2 min ago")).toBeInTheDocument();
  });

  it("opens the screen a notice is about, and marks it read", async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: /Notifications/ }));
    const items = await screen.findAllByTestId("notice");
    await user.click(items[1]);
    expect(h.markRead).toHaveBeenCalledWith(["n2"]);
    expect(h.navigate).toHaveBeenCalledWith({ href: "/app/approvals?m=leave" });
  });

  it("does not mark again one already read", async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: /Notifications/ }));
    await user.click((await screen.findAllByTestId("notice"))[2]);
    expect(h.markRead).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith({ href: "/app" });
  });

  it("marks every one read at once", async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: /Notifications/ }));
    await user.click(await screen.findByRole("button", { name: "Mark all as read" }));
    // Nothing named: every one.
    expect(h.markRead.mock.calls).toEqual([[]]);
    await waitFor(() => expect(screen.queryByTestId("bell-count")).toBeNull());
  });

  it("says so when there is nothing", async () => {
    h.countUnread.mockResolvedValue(0);
    h.listNotices.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(
      await screen.findByText("Nothing yet. What needs you will show up here."),
    ).toBeInTheDocument();
  });
});

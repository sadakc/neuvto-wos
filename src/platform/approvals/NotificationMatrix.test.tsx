// @vitest-environment happy-dom

/**
 * Who is told of what (D93), as a module's admin meets it. What it pins:
 *
 * - every event against every audience, the engine's own rules shown on and
 *   locked, the rest switchable, and switching sends exactly that cell;
 * - people named to be told as well are listed in a sentence, with their
 *   department, and can be removed;
 * - naming somebody sends who, when and for which department;
 * - where the emails come from is said, since it is not the admin's to set.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getNotificationMatrix: vi.fn(),
  setNotificationRule: vi.fn(),
  listCustomRecipients: vi.fn(),
  addCustomRecipient: vi.fn(),
  removeCustomRecipient: vi.fn(),
  listNotificationPeople: vi.fn(),
  listDepartments: vi.fn(),
}));
vi.mock("./index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index")>()),
  getNotificationMatrix: h.getNotificationMatrix,
  setNotificationRule: h.setNotificationRule,
  listCustomRecipients: h.listCustomRecipients,
  addCustomRecipient: h.addCustomRecipient,
  removeCustomRecipient: h.removeCustomRecipient,
  listNotificationPeople: h.listNotificationPeople,
}));
vi.mock("@/platform/organization", () => ({ listDepartments: h.listDepartments }));

import { NotificationMatrix } from "./NotificationMatrix";

const cell = (eventKey: string, audience: string, enabled: boolean, mandatory = false) => ({
  entityType: "leave_request",
  entityLabel: "leave request",
  eventKey,
  audience,
  enabled,
  mandatory,
});

beforeEach(() => {
  vi.resetAllMocks();
  h.getNotificationMatrix.mockResolvedValue([
    cell("approval.submitted", "approver", true, true),
    cell("approval.submitted", "requester", false),
    cell("approval.submitted", "requester_manager", false),
    cell("approval.submitted", "module_admins", true),
    cell("approval.completed", "requester", true, true),
    cell("approval.completed", "requester_manager", false),
    cell("approval.completed", "module_admins", false),
    cell("approval.escalated", "approver", true, true),
    cell("approval.escalated", "requester", false),
    cell("approval.escalated", "requester_manager", false),
    cell("approval.escalated", "module_admins", false),
  ]);
  h.listCustomRecipients.mockResolvedValue([
    {
      id: "c1",
      entityType: "leave_request",
      entityLabel: "leave request",
      eventKey: "approval.completed",
      profileId: "hema",
      personName: "Hema HR",
      departmentId: "ops",
      departmentName: "Operations",
    },
  ]);
  h.listNotificationPeople.mockResolvedValue([
    { id: "hema", fullName: "Hema HR" },
    { id: "dan", fullName: "Dan Director" },
  ]);
  h.listDepartments.mockResolvedValue([{ id: "ops", name: "Operations" }]);
  h.setNotificationRule.mockResolvedValue(undefined);
  h.addCustomRecipient.mockResolvedValue("c2");
  h.removeCustomRecipient.mockResolvedValue(undefined);
});

describe("who is told of what", () => {
  it("shows the engine's own rules on and locked, and the rest as they are set", async () => {
    render(<NotificationMatrix moduleKey="leave" adminLabel="Leave Admins" />);
    const locked = await screen.findByLabelText("Leave request raised: the approver (always)");
    expect(locked).toBeChecked();
    expect(locked).toBeDisabled();
    expect(
      screen.getByLabelText("Leave request approved or rejected: the person who asked (always)"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Leave request raised: Leave Admins")).toBeChecked();
    expect(screen.getByLabelText("Leave request raised: Leave Admins")).toBeEnabled();
    expect(screen.getByLabelText("Leave request moved up: their manager")).not.toBeChecked();
  });

  it("switches exactly the cell clicked", async () => {
    const user = userEvent.setup();
    render(<NotificationMatrix moduleKey="leave" adminLabel="Leave Admins" />);
    await user.click(
      await screen.findByLabelText("Leave request approved or rejected: their manager"),
    );
    expect(h.setNotificationRule).toHaveBeenCalledWith(
      "leave_request",
      "approval.completed",
      "requester_manager",
      true,
    );
    await user.click(screen.getByLabelText("Leave request raised: Leave Admins"));
    expect(h.setNotificationRule).toHaveBeenLastCalledWith(
      "leave_request",
      "approval.submitted",
      "module_admins",
      false,
    );
  });

  it("lists the people named, in a sentence, and removes one", async () => {
    const user = userEvent.setup();
    render(<NotificationMatrix moduleKey="leave" adminLabel="Leave Admins" />);
    const row = (await screen.findByText(/Hema HR is told/)).closest("li") as HTMLElement;
    expect(row).toHaveTextContent(
      "Hema HR is told when a leave request is approved or rejected · Operations only",
    );
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(h.removeCustomRecipient).toHaveBeenCalledWith("c1");
  });

  it("names somebody for one event and one department", async () => {
    const user = userEvent.setup();
    render(<NotificationMatrix moduleKey="leave" adminLabel="Leave Admins" />);
    await user.selectOptions(await screen.findByLabelText("Also tell"), "dan");
    await user.selectOptions(screen.getByLabelText("When"), "leave_request|approval.escalated");
    await user.selectOptions(screen.getByLabelText("For"), "ops");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(h.addCustomRecipient).toHaveBeenCalledWith(
      "leave_request",
      "approval.escalated",
      "dan",
      "ops",
    );
  });

  it("says where the emails come from", async () => {
    render(<NotificationMatrix moduleKey="leave" adminLabel="Leave Admins" />);
    expect(
      await screen.findByText(/sent from the address Neuvto's platform administrator set up/),
    ).toBeInTheDocument();
  });
});

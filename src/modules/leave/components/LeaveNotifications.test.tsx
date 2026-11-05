// @vitest-environment happy-dom

/** Leave's notification settings are the platform's matrix, for Leave (D93). */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/approvals/NotificationMatrix", () => ({
  NotificationMatrix: ({ moduleKey, adminLabel }: { moduleKey: string; adminLabel: string }) => (
    <p>
      matrix:{moduleKey}:{adminLabel}
    </p>
  ),
}));

import LeaveNotifications from "./LeaveNotifications";

describe("Leave notifications", () => {
  it("is the matrix for Leave's approvals, naming Leave's admins", () => {
    render(<LeaveNotifications />);
    expect(screen.getByText("matrix:leave:Leave Admins")).toBeInTheDocument();
  });
});

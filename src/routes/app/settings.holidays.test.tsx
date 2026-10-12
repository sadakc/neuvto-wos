// @vitest-environment happy-dom

/**
 * Removing a holiday says what it does first (Leave phase 2, criterion 6).
 * A holiday is excluded from every leave count, so removing one changes how
 * future requests over that date are counted, and leaves past ones as they
 * were. The screen says so, and removes only on confirmation.
 */

import type { ComponentType } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listHolidays: vi.fn(),
  removeHoliday: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));
vi.mock("@/platform/auth", async () => {
  const { isAdmin, isModuleAdmin, administersAnyModule } = await import("@/platform/auth/session");
  return {
    isAdmin,
    isModuleAdmin,
    administersAnyModule,
    getCurrentUser: async () => ({
      id: "alice",
      email: "alice@acme.test",
      fullName: "Alice",
      organizationId: "org",
      organizationName: "Acme",
      roles: ["org_admin"],
    }),
  };
});
vi.mock("@/platform/calendar", () => ({
  listHolidays: h.listHolidays,
  removeHoliday: h.removeHoliday,
  addHoliday: vi.fn(),
}));
vi.mock("@/platform/calendar/WorkingCalendar", () => ({ WorkingCalendar: () => null }));
vi.mock("@/platform/modules", () => ({ getAdminSections: async () => [], OrgModules: () => null }));
vi.mock("@/platform/organization/CompanyIdentity", () => ({ CompanyIdentity: () => null }));
vi.mock("@/platform/organization/Departments", () => ({ Departments: () => null }));

const { Route } = await import("./settings");
const Page = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  vi.resetAllMocks();
  h.listHolidays.mockResolvedValue([
    { id: "h1", name: "Diwali", holidayDate: "2099-11-09", organizationId: "org" },
  ]);
  h.removeHoliday.mockResolvedValue(undefined);
});

describe("removing a holiday", () => {
  it("says what it changes, and removes only when confirmed", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("counted as a working day");
    expect(dialog).toHaveTextContent("Leave already applied for is not recounted");
    expect(h.removeHoliday).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Remove Diwali" }));
    expect(h.removeHoliday).toHaveBeenCalledWith("h1");
  });
});

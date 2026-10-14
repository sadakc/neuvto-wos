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
  listCalendars: vi.fn(),
  setHolidayCalendars: vi.fn(),
  getAdminSections: vi.fn(),
  /** The page's ?m=, as the router holds it. */
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { search: h.search } }),
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
  listCalendars: h.listCalendars,
  setHolidayCalendars: h.setHolidayCalendars,
}));
vi.mock("@/platform/calendar/WorkingCalendar", () => ({ WorkingCalendar: () => null }));
vi.mock("@/platform/modules", () => ({
  getAdminSections: h.getAdminSections,
  OrgModules: () => null,
}));
vi.mock("@/platform/organization/CompanyIdentity", () => ({ CompanyIdentity: () => null }));
vi.mock("@/platform/organization/Departments", () => ({ Departments: () => null }));

const { Route } = await import("./settings");
const Page = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  vi.resetAllMocks();
  h.search = {};
  h.getAdminSections.mockResolvedValue([
    {
      moduleKey: "leave",
      id: "leave-types",
      title: "Leave types",
      description: "What people can apply for.",
      component: () => <p>The leave types</p>,
    },
    {
      moduleKey: "payroll",
      id: "pay-heads",
      title: "Pay heads",
      component: () => <p>The pay heads</p>,
    },
  ]);
  h.listHolidays.mockResolvedValue([
    { id: "h1", name: "Diwali", holidayDate: "2099-11-09", organizationId: "org", calendarIds: [] },
    {
      id: "h2",
      name: "Rajyotsava",
      holidayDate: "2099-11-01",
      organizationId: "org",
      calendarIds: ["c-blr"],
    },
  ]);
  h.removeHoliday.mockResolvedValue(undefined);
  h.listCalendars.mockResolvedValue([
    { id: "c-co", name: "Company calendar", weeklyOff: [0, 6], isDefault: true },
    { id: "c-blr", name: "Bengaluru sites", weeklyOff: [0], isDefault: false },
  ]);
  h.setHolidayCalendars.mockResolvedValue(undefined);
});

/** Settings shows one section at a time (Core HR design); Holidays is its own. */
async function openHolidays() {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByTestId("settings-holidays"));
  return user;
}

describe("removing a holiday", () => {
  it("says what it changes, and removes only when confirmed", async () => {
    const user = await openHolidays();
    await user.click((await screen.findAllByRole("button", { name: "Remove" }))[0]);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("counted as a working day");
    expect(dialog).toHaveTextContent("Leave already applied for is not recounted");
    expect(h.removeHoliday).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Remove Diwali" }));
    expect(h.removeHoliday).toHaveBeenCalledWith("h1");
  });
});

describe("which calendars a holiday applies to (D102)", () => {
  it("says every calendar or names them, and limits one when asked", async () => {
    const user = await openHolidays();
    const diwali = (await screen.findByText("Diwali")).closest("li")!;
    expect(diwali).toHaveTextContent("All calendars");
    const raj = screen.getByText("Rajyotsava").closest("li")!;
    expect(raj).toHaveTextContent("Bengaluru sites only");

    await user.click(within(diwali).getByRole("button", { name: "Applies to" }));
    await user.click(within(diwali).getByLabelText("Bengaluru sites"));
    await user.click(within(diwali).getByRole("button", { name: "Save" }));
    expect(h.setHolidayCalendars).toHaveBeenCalledWith("h1", ["c-blr"]);
  });

  it("offers no choice when the company has one calendar", async () => {
    h.listCalendars.mockResolvedValue([
      { id: "c-co", name: "Company calendar", weeklyOff: [0, 6], isDefault: true },
    ]);
    await openHolidays();
    await screen.findByText("Diwali");
    expect(screen.queryByRole("button", { name: "Applies to" })).toBeNull();
  });
});

describe("whose settings these are (Sada, 14 Oct 2026)", () => {
  it("opened from Organisation: the company's sections, not a module's", async () => {
    render(<Page />);
    await screen.findByTestId("settings-holidays");
    expect(screen.getByRole("heading", { name: "Workspace settings" })).toBeInTheDocument();
    for (const id of ["company", "calendar", "departments", "holidays", "modules"]) {
      expect(screen.getByTestId(`settings-${id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("settings-leave-leave-types")).toBeNull();
  });

  it("opened from Leave's Configuration: Leave's sections alone, numbered", async () => {
    h.search = { m: "leave" };
    render(<Page />);
    expect(await screen.findByTestId("settings-leave-leave-types")).toHaveTextContent(
      "01 Leave types",
    );
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
    expect(screen.queryByTestId("settings-holidays")).toBeNull();
    expect(screen.queryByTestId("settings-payroll-pay-heads")).toBeNull();
    expect(screen.getByText("The leave types")).toBeInTheDocument();
  });
});

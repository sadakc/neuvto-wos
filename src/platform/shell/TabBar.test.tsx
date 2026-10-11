// @vitest-environment happy-dom
/**
 * The tab bar as rendered, per role.
 *
 * fit.test.ts proves the arithmetic. This proves the screen does what the
 * arithmetic says, in the DOM: a Company tab is ABSENT for a role that cannot
 * use it (not disabled, not hidden by CSS), the active tab is marked current,
 * and the section picker groups what it lists the way DESIGN_SYSTEM §7 says.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import type { AppRole, CurrentUser } from "@/platform/auth";
import type { ModuleDefinition } from "@/platform/modules";
import { buildShell } from "./model";
import { TabBar } from "./TabBar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children?: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a href={to + (search ? `?${new URLSearchParams(search)}` : "")} {...rest}>
      {children}
    </a>
  ),
}));

const user = (roles: AppRole[]): CurrentUser => ({
  id: "u",
  email: "u@acme.test",
  fullName: "U",
  organizationId: "o",
  organizationName: "Acme",
  roles,
});

const leave: ModuleDefinition = {
  key: "leave",
  name: "Leave Management",
  version: "1",
  navigation: () => [
    { label: "Apply Leave", to: "/app/leave/apply" },
    { label: "My Leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
  ],
  routes: [],
  reports: () => [],
  adminSections: () => [],
  approvalEntityTypes: ["leave_request"],
  eventKeys: [],
  settingsSchema: z.object({}),
  ownedTables: [],
};

const leaveFor = (roles: AppRole[]) =>
  buildShell(user(roles), [leave]).find((m) => m.key === "leave")!;

describe("row mode", () => {
  it("an employee gets no Company menu and no Approvals tab in the DOM at all", () => {
    render(<TabBar module={leaveFor(["employee"])} activeTabId="/app/leave" forceWidth={1200} />);
    expect(screen.queryByTestId("tab-company")).toBeNull();
    expect(screen.queryByTestId("tab-approvals")).toBeNull();
    expect(screen.getByTestId("tab-/app/leave")).toHaveAttribute("aria-current", "page");
    // Three were left out, and the note says so.
    expect(screen.getByTestId("role-note")).toHaveTextContent("3 tabs hidden for this role");
  });

  it("an administrator gets Company, with Reports and Configuration behind it", async () => {
    render(
      <TabBar
        module={leaveFor(["employee", "org_admin"])}
        activeTabId="/app/leave"
        forceWidth={1200}
      />,
    );
    expect(screen.getByTestId("tab-approvals")).toHaveAttribute("href", "/app/approvals?m=leave");
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByTestId("tab-company"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Reports").closest("a")).toHaveAttribute(
      "href",
      "/app/reports?m=leave",
    );
    expect(within(menu).getByText("Configuration").closest("a")).toHaveAttribute(
      "href",
      "/app/settings?m=leave",
    );
    expect(screen.queryByTestId("role-note")).toBeNull();
  });

  it("marks Company as current when the active section is behind it", () => {
    render(
      <TabBar
        module={leaveFor(["employee", "org_admin"])}
        activeTabId="reports"
        forceWidth={1200}
      />,
    );
    expect(screen.getByTestId("tab-company")).toHaveAttribute("data-current", "true");
    expect(screen.getByTestId("tab-company")).toHaveAccessibleName("Company, current: Reports");
  });

  it("Escape closes the menu and gives focus back to the button that opened it", async () => {
    render(
      <TabBar
        module={leaveFor(["employee", "org_admin"])}
        activeTabId="/app/leave"
        forceWidth={1200}
      />,
    );
    const company = screen.getByTestId("tab-company");
    await userEvent.click(company);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(company).toHaveFocus();
  });
});

describe("pick mode, below 540px", () => {
  it("collapses to one picker that names the current section", () => {
    render(
      <TabBar
        module={leaveFor(["employee", "manager"])}
        activeTabId="/app/leave/calendar"
        forceWidth={390}
      />,
    );
    const picker = screen.getByTestId("tab-picker");
    expect(picker).toHaveTextContent("Calendar");
    expect(picker).toHaveTextContent("4 sections");
    expect(screen.queryByTestId("tab-/app/leave")).toBeNull();
  });

  it("groups the panel as the module, For your team, then Company", async () => {
    render(
      <TabBar
        module={leaveFor(["employee", "org_admin"])}
        activeTabId="/app/leave"
        forceWidth={390}
      />,
    );
    await userEvent.click(screen.getByTestId("tab-picker"));
    const groups = within(screen.getByRole("menu")).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Leave Management",
      "For your team",
      "Company",
    ]);
  });

  it("an employee's picker has no team or Company group, and says what is hidden", async () => {
    render(<TabBar module={leaveFor(["employee"])} activeTabId="/app/leave" forceWidth={390} />);
    await userEvent.click(screen.getByTestId("tab-picker"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("group")).toHaveLength(1);
    expect(menu).toHaveTextContent("3 tabs hidden for this role");
  });
});

describe("row mode, when the tabs do not all fit", () => {
  // Six 150px tabs, `More` at 80px, a 600px bar: 570px available, 490px once
  // `More` is reserved, so the natural cut is after the third tab. Widths are
  // stubbed because happy-dom has no layout; the bar width comes from the
  // component's own `forceWidth` seam.
  const wide: ModuleDefinition = {
    ...leave,
    navigation: () =>
      ["One", "Two", "Three", "Four", "Five", "Six"].map((label) => ({
        label,
        to: `/app/leave/${label.toLowerCase()}`,
      })),
  };
  const module = buildShell(user(["employee"]), [wide]).find((m) => m.key === "leave")!;

  let original: PropertyDescriptor | undefined;
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute("data-tab")) return 150;
        if (this.hasAttribute("data-more")) return 80;
        if (this.hasAttribute("data-note")) return 200;
        return 0;
      },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  });

  const shown = () =>
    Array.from(
      screen.getByRole("navigation").querySelectorAll("a[data-testid^=tab-]"),
      (a) => a.textContent,
    );

  it("the natural cut leaves the first three and puts the rest behind More", async () => {
    render(<TabBar module={module} activeTabId="/app/leave/one" forceWidth={600} />);
    expect(shown()).toEqual(["One", "Two", "Three"]);
    await userEvent.click(screen.getByTestId("tab-more"));
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((a) => a.textContent),
    ).toEqual(["Four", "Five", "Six"]);
  });

  it.each(["four", "six"])("an active tab past the cut (%s) is still in the row", (label) => {
    render(<TabBar module={module} activeTabId={`/app/leave/${label}`} forceWidth={600} />);
    expect(screen.getByTestId(`tab-/app/leave/${label}`)).toHaveAttribute("aria-current", "page");
    // It displaced a tab rather than overflowing the bar: still three in the row.
    expect(shown()).toHaveLength(3);
    expect(screen.getByTestId("tab-more")).toBeInTheDocument();
  });
});

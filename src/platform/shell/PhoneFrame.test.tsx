// @vitest-environment happy-dom
/**
 * Doc 11 on a 390px stage, against the shell model for each role. What it pins:
 *
 * - under 600px there is an app bar and a bottom bar, and no tab row and no
 *   rail; at 600px and above, none of the phone shell;
 * - a module's home shows the tiles for its other sections, and Company as
 *   one tile only for a role that has company sections;
 * - the title menu opens a sheet of exactly the sections the role may open,
 *   the current one marked, with no empty group and a count of what is hidden;
 * - choosing a sibling from a section replaces the history entry; from the
 *   home it does not; the back arrow goes to the module's home;
 * - a screen's own sections (a person's record) take over the title menu and
 *   the back arrow, and the tiles are not shown above an open section.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { z } from "zod";
import type { AppRole, CurrentUser } from "@/platform/auth";
import type { ModuleDefinition } from "@/platform/modules";

const where = vi.hoisted(() => ({
  pathname: "/app/leave",
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: where.pathname }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { search: where.search } }),
  useNavigate: () => where.navigate,
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
vi.mock("@/platform/approvals", () => ({ listApprovalQueue: vi.fn(async () => []) }));

import { AppFrame } from "./AppFrame";
import { buildShell } from "./model";
import { useSubNav } from "./phone-context";

const person = (roles: AppRole[]): CurrentUser => ({
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
  shortName: "Leave",
  version: "1",
  home: "/app/leave",
  navigation: () => [
    { label: "Apply Leave", to: "/app/leave/apply" },
    { label: "My Leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
  ],
  tileLines: async () => ({ "/app/leave/apply": "5.25 days available" }),
  routes: [],
  reports: () => [],
  adminSections: () => [],
  approvalEntityTypes: ["leave_request"],
  eventKeys: [],
  settingsSchema: z.object({}),
  ownedTables: [],
};

const frame = (roles: AppRole[], children: React.ReactNode = <p>screen</p>) =>
  render(
    <AppFrame
      modules={buildShell(person(roles), [leave])}
      brand={<span>Acme</span>}
      actions={<span data-testid="desktop-actions" />}
      phone={{ initials: "UU", trailing: <span data-testid="bell" /> }}
    >
      {children}
    </AppFrame>,
  );

let width = 390;
let original: PropertyDescriptor | undefined;
beforeEach(() => {
  width = 390;
  where.pathname = "/app/leave";
  where.search = {};
  where.navigate.mockReset();
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
});
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});

const sheetLabels = () =>
  within(screen.getByTestId("section-sheet"))
    .getAllByRole("button")
    .filter((b) => b.dataset.testid?.startsWith("sheet-"))
    .map((b) => b.querySelector("span span")?.textContent);

describe("under 600px the shell is replaced", () => {
  it("by an app bar and a bottom bar, with no tab row and no rail", () => {
    frame(["employee"]);
    expect(screen.getByTestId("app-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(document.querySelector("nav[data-mode]")).toBeNull();
    expect(document.querySelector("[data-rail]")).toBeNull();
    expect(screen.queryByTestId("desktop-actions")).toBeNull();
    expect(screen.getByTestId("bell")).toBeInTheDocument();
  });

  it("and not at 600px", () => {
    width = 600;
    frame(["employee"]);
    expect(screen.queryByTestId("app-bar")).toBeNull();
    expect(screen.queryByTestId("bottom-nav")).toBeNull();
    expect(document.querySelector("[data-rail]")).not.toBeNull();
  });

  it("the bottom bar carries every module, the current one marked", () => {
    frame(["employee"]);
    const bar = screen.getByTestId("bottom-nav");
    expect(
      within(bar)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Home", "Leave"]);
    expect(within(bar).getByTestId("bottom-leave")).toHaveAttribute("aria-current", "page");
  });
});

describe("a module's home", () => {
  it("shows its other sections as tiles, with the live line where there is one", async () => {
    frame(["employee"]);
    const hub = screen.getByTestId("hub");
    expect(
      within(hub)
        .getAllByRole("link")
        .map((l) => l.querySelector("span")?.textContent),
    ).toEqual(["Apply Leave", "Calendar"]);
    expect(await within(hub).findByText("5.25 days available")).toBeInTheDocument();
    expect(screen.queryByTestId("tile-company")).toBeNull();
    // At home the leading slot is the avatar, not a back arrow.
    expect(screen.getByTestId("app-bar-avatar")).toBeInTheDocument();
    expect(screen.getByTestId("title-menu")).toHaveTextContent("My Leave");
  });

  it("gives an admin one Company tile, which opens the sheet", async () => {
    const user = userEvent.setup();
    frame(["employee", "org_admin"]);
    await user.click(screen.getByTestId("tile-company"));
    expect(screen.getByTestId("section-sheet")).toHaveTextContent("Company");
    expect(sheetLabels()).toContain("Configuration");
  });

  it("is not where the tiles show anywhere else", () => {
    where.pathname = "/app/leave/apply";
    frame(["employee"]);
    expect(screen.queryByTestId("hub")).toBeNull();
    expect(screen.getByTestId("app-bar-back")).toBeInTheDocument();
  });
});

describe("the title menu", () => {
  it("lists exactly what an employee may open, the current one marked, and counts the rest", async () => {
    const user = userEvent.setup();
    frame(["employee"]);
    await user.click(screen.getByTestId("title-menu"));
    expect(sheetLabels()).toEqual(["Apply Leave", "My Leave", "Calendar"]);
    expect(screen.getByTestId("sheet-/app/leave")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("section-sheet")).not.toHaveTextContent("Company");
    expect(screen.getByTestId("section-sheet")).not.toHaveTextContent("For your team");
    expect(screen.getByTestId("sheet-footer")).toHaveTextContent("hidden for this role");
  });

  it("lists an admin's company sections too", async () => {
    const user = userEvent.setup();
    frame(["employee", "org_admin"]);
    await user.click(screen.getByTestId("title-menu"));
    expect(sheetLabels()).toEqual([
      "Apply Leave",
      "My Leave",
      "Calendar",
      "Leave approvals",
      "Approval rules",
      "Reports",
      "Configuration",
    ]);
  });

  it("replaces the history entry moving sideways from a section, so back lands on the home", async () => {
    const user = userEvent.setup();
    where.pathname = "/app/leave/apply";
    frame(["employee"]);
    await user.click(screen.getByTestId("title-menu"));
    await user.click(screen.getByTestId("sheet-/app/leave/calendar"));
    expect(where.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/app/leave/calendar", replace: true }),
    );
  });

  it("does not replace it going from the home to a section", async () => {
    const user = userEvent.setup();
    frame(["employee"]);
    await user.click(screen.getByTestId("title-menu"));
    await user.click(screen.getByTestId("sheet-/app/leave/apply"));
    expect(where.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/app/leave/apply", replace: false }),
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    frame(["employee"]);
    await user.click(screen.getByTestId("title-menu"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("section-sheet")).toBeNull();
  });
});

describe("the back arrow", () => {
  it("goes from a section to the module's home", async () => {
    const user = userEvent.setup();
    where.pathname = "/app/leave/calendar";
    frame(["employee"]);
    await user.click(screen.getByTestId("app-bar-back"));
    expect(where.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/app/leave" }));
  });
});

/** A screen with sections of its own, as a person's record declares them. */
function Record() {
  const [current, setCurrent] = useState("");
  useSubNav({
    title: "Priya Employee",
    items: [
      { id: "overview", label: "Overview", group: "Record" },
      { id: "history", label: "History", group: "Audit trail" },
    ],
    current,
    select: setCurrent,
    clear: () => setCurrent(""),
  });
  return current ? (
    <p data-testid="open-section">{current}</p>
  ) : (
    <button type="button" onClick={() => setCurrent("history")}>
      open History
    </button>
  );
}

describe("a screen's own sections", () => {
  it("take over the title, the menu and the back arrow, and the tiles step aside", async () => {
    const user = userEvent.setup();
    frame(["employee"], <Record />);
    expect(screen.getByTestId("hub")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "open History" }));

    expect(screen.getByTestId("title-menu")).toHaveTextContent("History");
    expect(screen.getByTestId("title-menu")).toHaveTextContent("Priya Employee");
    expect(screen.queryByTestId("hub")).toBeNull();

    await user.click(screen.getByTestId("title-menu"));
    expect(sheetLabels()).toEqual(["Overview", "History"]);
    expect(screen.getByTestId("section-sheet")).toHaveTextContent("Audit trail");
    await user.click(screen.getByTestId("sheet-overview"));
    expect(screen.getByTestId("open-section")).toHaveTextContent("overview");

    await act(async () => {
      await user.click(screen.getByTestId("app-bar-back"));
    });
    expect(screen.queryByTestId("open-section")).toBeNull();
    expect(screen.getByTestId("hub")).toBeInTheDocument();
    expect(where.navigate).not.toHaveBeenCalled();
  });
});

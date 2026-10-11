// @vitest-environment happy-dom
/**
 * The frame decides which module and tab are current from the URL.
 *
 * /app/approvals is one queue shared by Home and by every module that raises
 * approvals; `?m=leave` is the only thing that says it was opened from Leave.
 * If the frame drops it, the rail jumps to Home under somebody who clicked
 * Leave's Approvals tab, and the tab they clicked is no longer on screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import type { CurrentUser } from "@/platform/auth";
import type { ModuleDefinition } from "@/platform/modules";
import { AppFrame } from "./AppFrame";
import { buildShell } from "./model";

const where = vi.hoisted(() => ({ pathname: "/app", search: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: where.pathname }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { search: where.search } }),
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

const manager: CurrentUser = {
  id: "u",
  email: "m@acme.test",
  fullName: "M",
  organizationId: "o",
  organizationName: "Acme",
  roles: ["employee", "manager"],
};

const leave: ModuleDefinition = {
  key: "leave",
  name: "Leave Management",
  version: "1",
  navigation: () => [{ label: "My Leave", to: "/app/leave" }],
  routes: [],
  reports: () => [],
  adminSections: () => [],
  approvalEntityTypes: ["leave_request"],
  eventKeys: [],
  settingsSchema: z.object({}),
  ownedTables: [],
};

const frame = () =>
  render(
    <AppFrame modules={buildShell(manager, [leave])} brand={null} actions={null}>
      <p>screen</p>
    </AppFrame>,
  );

// happy-dom has no layout, so every element is 0px wide, and a 0px tab bar is
// a phone-width section picker. 1200px is a desktop: the rail is a column and
// the tabs are a row, which is the layout these assertions are about.
let original: PropertyDescriptor | undefined;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1200,
  });
});
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});

describe("which module the shared approvals queue belongs to", () => {
  beforeEach(() => {
    where.pathname = "/app/approvals";
    where.search = {};
  });

  it("?m=leave selects Leave in the rail and Leave's Approvals tab", () => {
    where.search = { m: "leave" };
    frame();
    expect(screen.getByTestId("rail-leave")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("rail-home")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("navigation", { name: "Leave Management sections" })).toBeVisible();
    expect(screen.getByTestId("tab-approvals")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("tab-approvals")).toHaveAttribute("href", "/app/approvals?m=leave");
  });

  it("without ?m= the same path is Home's queue", () => {
    frame();
    expect(screen.getByTestId("rail-home")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("rail-leave")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("tab-approvals")).toHaveAttribute("href", "/app/approvals");
  });
});

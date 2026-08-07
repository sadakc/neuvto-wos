// @vitest-environment happy-dom

/**
 * The Reports page, and the section that now hangs underneath it.
 *
 * Two promises are worth a render test here, and they are not the tabs.
 *
 * The first is the gate. Every report function behind this screen raises
 * FORBIDDEN for a non-administrator on its own, so the check in this file is
 * presentation — but the scheduled-reports panel is a FORM, and a form rendered
 * to somebody who may not submit it is a screen that takes something away after
 * offering it. The panel must not be mounted at all for a non-admin, which is a
 * stronger claim than "not visible" and is why this file asserts that its data
 * calls never happened rather than that its markup is absent.
 *
 * The second is that scheduling is attached to the reports it schedules — below
 * the tabs, on the same screen, rather than filed somewhere in Settings where
 * the person looking at a report would never find it.
 *
 * Mocked at the seam and no further: the router, `getCurrentUser`,
 * `getModuleReports`, and the four calls `ScheduledReports` makes to the
 * database. `isAdmin` is the REAL function — a stubbed one would let this file
 * assert that a Supervisor is kept out while the app lets them in — and so are
 * every sentence-building helper in `schedules.ts`.
 *
 * The unmocked-data-layer failure of PR #66 is the specific thing being avoided
 * by mocking `@/platform/reports/schedules` here: this route renders
 * `ScheduledReports`, which reaches for the database on mount and swallows the
 * failure. Left alone it would fire real HTTP at 127.0.0.1:54321 and pass anyway.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AppError } from "@/platform/errors";
import type { CurrentUser } from "@/platform/auth";
import type { ModuleReport } from "@/platform/modules";
import type { ReportDefinition, ReportSchedule } from "@/platform/reports";

// ── the seam

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

const getCurrentUser = vi.fn<() => Promise<CurrentUser | null>>();

vi.mock("@/platform/auth", async () => {
  // The real role helper. `session` imports the Supabase client, which is a lazy
  // Proxy that constructs nothing until a query runs.
  const { isAdmin } = await import("@/platform/auth/session");
  return { isAdmin, getCurrentUser: () => getCurrentUser() };
});

const getModuleReports = vi.fn<() => Promise<(ModuleReport & { moduleKey: string })[]>>();

vi.mock("@/platform/modules", () => ({
  getModuleReports: () => getModuleReports(),
}));

const listReportDefinitions = vi.fn<() => Promise<ReportDefinition[]>>();
const listSchedules = vi.fn<() => Promise<ReportSchedule[]>>();

vi.mock("@/platform/reports/schedules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/reports/schedules")>();
  return {
    ...actual,
    listReportDefinitions: () => listReportDefinitions(),
    listSchedules: () => listSchedules(),
    saveSchedule: vi.fn(),
    removeSchedule: vi.fn(),
  };
});

import { Route } from "./reports";

/** Not exported; reached through the route options the mocked router returns. */
const ReportsPage = (Route as unknown as { component: () => React.ReactElement }).component;

const userWith = (roles: CurrentUser["roles"]): CurrentUser => ({
  id: "person-id",
  email: "person@acme.test",
  fullName: "Sunita Kapoor",
  organizationId: "org",
  organizationName: "Acme",
  roles,
});

const REPORTS: (ModuleReport & { moduleKey: string })[] = [
  {
    moduleKey: "leave",
    id: "balances",
    title: "Leave balances",
    description: "Where everybody stands today.",
    component: () => <p data-testid="report-body">balances</p>,
  },
  {
    moduleKey: "leave",
    id: "requests",
    title: "Every request",
    component: () => <p data-testid="report-body">requests</p>,
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  getModuleReports.mockResolvedValue(REPORTS);
  listReportDefinitions.mockResolvedValue([
    { key: "leave.summary", title: "Leave summary", description: null },
  ]);
  listSchedules.mockResolvedValue([]);
});

describe("Reports — who the page is for", () => {
  it("tells a Supervisor it is administrators only, and mounts no scheduling form", async () => {
    // D57: approving is not administering. The panel below is a form that
    // writes; not rendering it is the point, and the data calls are the proof
    // that it was never mounted rather than merely hidden by a class.
    getCurrentUser.mockResolvedValue(userWith(["supervisor"]));

    render(<ReportsPage />);

    expect(await screen.findByText("Administrators only")).toBeInTheDocument();
    expect(screen.queryByText("Scheduled reports")).toBeNull();
    expect(screen.queryByTestId("add-schedule")).toBeNull();
    expect(listSchedules).not.toHaveBeenCalled();
    expect(listReportDefinitions).not.toHaveBeenCalled();
    // Nor are the reports themselves fetched for somebody who may not read them.
    expect(getModuleReports).not.toHaveBeenCalled();
  });

  it("gives an administrator the reports and the scheduling section under them", async () => {
    getCurrentUser.mockResolvedValue(userWith(["org_admin"]));

    render(<ReportsPage />);

    // Waited on something that exists only once loaded — never a node the
    // skeleton also renders, which is how a helper reads the wrong state and
    // passes by luck.
    expect(await screen.findByRole("tab", { name: "Leave balances" })).toBeInTheDocument();

    const heading = screen.getByRole("heading", { name: "Scheduled reports", level: 2 });

    // Below the reports, not beside them: a schedule is how one of the reports
    // above arrives, so it reads in that order or not at all. Phrased as words
    // rather than a bitmask so that a failure says which way round it ended up.
    const tabs = screen.getByRole("tablist");
    const wherePut =
      tabs.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
        ? "below the report tabs"
        : "above the report tabs";
    expect(wherePut).toBe("below the report tabs");

    // And the section genuinely hosts the panel, rather than a heading with
    // nothing under it.
    const section = heading.closest("section") as HTMLElement;
    expect(await within(section).findByTestId("add-schedule")).toBeInTheDocument();
    expect(within(section).getByText(/Nothing is scheduled/)).toBeInTheDocument();
  });

  it("keeps the reports readable when the scheduling panel cannot load", async () => {
    // One panel failing must not take the page with it. An administrator who
    // came to read a report still reads it, and is told plainly that the other
    // thing did not load.
    getCurrentUser.mockResolvedValue(userWith(["org_admin"]));
    listSchedules.mockRejectedValueOnce(new AppError("INTERNAL_ERROR", "boom", 500));

    render(<ReportsPage />);

    expect(await screen.findByRole("tab", { name: "Leave balances" })).toBeInTheDocument();
    expect(screen.getByTestId("report-body")).toHaveTextContent("balances");
    expect(
      await screen.findByText(/We couldn't load your scheduled reports just now/),
    ).toBeInTheDocument();
  });
});

// @vitest-environment happy-dom

/**
 * The Org Chart. What it promises:
 *
 * - it starts from the person you report to, so you see yourself and your peers;
 * - it draws four levels and then offers "Start here" rather than drawing on;
 * - somebody whose manager is not in the chart is drawn, at the top, not lost.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgChartNode } from "../contracts";

const getOrgChart = vi.hoisted(() => vi.fn());
const getUserId = vi.hoisted(() => vi.fn());
vi.mock("../handlers", () => ({ getOrgChart }));
vi.mock("@/platform/auth", () => ({ getUserId }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

import OrgChart from "./OrgChart";

function node(p: string, manager: string | null, reports = 0): OrgChartNode {
  return {
    id: `e-${p}`,
    profileId: p,
    managerProfileId: manager,
    fullName: p,
    designation: null,
    directReports: reports,
  };
}

// ceo → dan → mark → priya → lead → junior : six levels.
const CHAIN = [
  node("ceo", null, 1),
  node("dan", "ceo", 1),
  node("mark", "dan", 2),
  node("ravi", "mark"),
  node("priya", "mark", 1),
  node("lead", "priya", 1),
  node("junior", "lead"),
];

beforeEach(() => {
  getOrgChart.mockReset();
  getUserId.mockReset();
});

describe("OrgChart", () => {
  it("starts from your manager and shows your peers", async () => {
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("priya");
    render(<OrgChart />);
    expect(await screen.findByText("Starting from")).toBeInTheDocument();
    const names = screen.getAllByTestId("org-node").map((n) => n.querySelector("a")?.textContent);
    expect(names.slice(0, 3)).toEqual(["mark", "priya", "lead"]);
    expect(names).toContain("ravi");
    expect(names).not.toContain("dan");
  });

  it("draws four levels from the top, then offers to start further down", async () => {
    const user = userEvent.setup();
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("ceo");
    render(<OrgChart />);
    await screen.findByTestId("org-chart");
    const names = screen.getAllByTestId("org-node").map((n) => n.querySelector("a")?.textContent);
    expect(names).toEqual(["ceo", "dan", "mark", "priya", "ravi"]);
    expect(names).not.toContain("lead");

    await user.click(screen.getByTestId("org-start-here"));
    const after = screen.getAllByTestId("org-node").map((n) => n.querySelector("a")?.textContent);
    expect(after).toEqual(["priya", "lead", "junior"]);
  });

  it("draws somebody whose manager is not in the chart, at the top", async () => {
    getOrgChart.mockResolvedValue([node("alice", null), node("orphan", "deactivated-boss")]);
    getUserId.mockResolvedValue("alice");
    render(<OrgChart />);
    await screen.findByTestId("org-chart");
    const names = screen.getAllByTestId("org-node").map((n) => n.querySelector("a")?.textContent);
    expect(names).toEqual(["alice", "orphan"]);
  });
});

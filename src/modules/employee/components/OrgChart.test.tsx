// @vitest-environment happy-dom

/**
 * The Org Chart. What it promises:
 *
 * - under Organisation, the whole company from the top (Sada, 14 Oct 2026),
 *   with you marked; on the Employee Card, only your own line (MyOrgChart);
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
  it("lists the whole company from the top, with you marked", async () => {
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("priya");
    render(<OrgChart />);
    await screen.findAllByTestId("org-node");
    expect(screen.queryByText("Starting from")).toBeNull();
    const names = screen.getAllByTestId("org-node").map((n) => n.querySelector("a")?.textContent);
    expect(names.slice(0, 3)).toEqual(["ceo", "dan", "mark"]);
    expect(names).toContain("priya");
    expect(names).toContain("ravi");
    expect(screen.getByTestId("org-you")).toHaveTextContent("priya");
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

describe("folding a team away (D106)", () => {
  it("hides somebody's team with the minus, and shows it again with the plus", async () => {
    const user = userEvent.setup();
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("priya");
    render(<OrgChart />);
    // Starting from Mark: Ravi and Priya are his team.
    expect(await screen.findByText("ravi")).toBeInTheDocument();
    const fold = screen.getByRole("button", { name: "Hide mark's team" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    await user.click(fold);
    expect(screen.queryByText("ravi")).toBeNull();
    expect(screen.queryByText("priya")).toBeNull();
    const open = screen.getByRole("button", { name: "Show mark's team" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    await user.click(open);
    expect(screen.getByText("ravi")).toBeInTheDocument();
    // Nobody without reports has one.
    expect(screen.queryByRole("button", { name: "Hide ravi's team" })).toBeNull();
  });

  it("folds every team at once, and opens them all again", async () => {
    const user = userEvent.setup();
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue(null);
    render(<OrgChart />);
    expect(await screen.findByText("dan")).toBeInTheDocument();
    await user.click(screen.getByTestId("org-fold-all"));
    expect(screen.getByText("ceo")).toBeInTheDocument();
    expect(screen.queryByText("dan")).toBeNull();
    await user.click(screen.getByTestId("org-open-all"));
    expect(screen.getByText("dan")).toBeInTheDocument();
    expect(screen.getByText("mark")).toBeInTheDocument();
  });
});

import MyOrgChart from "./MyOrgChart";

describe("your own line, on the Employee Card", () => {
  const line = () =>
    screen
      .getAllByTestId("line-node")
      .map((n) => n.querySelector("a")?.textContent ?? n.textContent);

  it("runs from the top of the company down to you, then your team, and no peers", async () => {
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("priya");
    render(<MyOrgChart />);
    await screen.findAllByTestId("line-node");
    expect(line()).toEqual(["ceo", "dan", "mark", "priya"]);
    expect(screen.getByTestId("line-you")).toHaveTextContent("priya");
    expect(
      screen.getAllByTestId("line-report").map((n) => n.querySelector("a")?.textContent),
    ).toEqual(["lead"]);
    // Ravi reports to Mark too, but he is not in Priya's line.
    expect(screen.queryByText("ravi")).toBeNull();
    // Nor is the lead's own report.
    expect(screen.queryByText("junior")).toBeNull();
  });

  it("is only you and your team when you report to nobody", async () => {
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("ceo");
    render(<MyOrgChart />);
    await screen.findAllByTestId("line-node");
    expect(line()).toEqual(["ceo"]);
    expect(screen.getAllByTestId("line-report")).toHaveLength(1);
  });

  it("says so when you have no team", async () => {
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("ravi");
    render(<MyOrgChart />);
    await screen.findAllByTestId("line-node");
    expect(line()).toEqual(["ceo", "dan", "mark", "ravi"]);
    expect(screen.getByText("Nobody reports to you.")).toBeInTheDocument();
  });

  it("says so when you are not on the chart yet", async () => {
    getOrgChart.mockResolvedValue(CHAIN);
    getUserId.mockResolvedValue("somebody-new");
    render(<MyOrgChart />);
    expect(await screen.findByText(/not on the org chart yet/)).toBeInTheDocument();
  });
});

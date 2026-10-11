// @vitest-environment happy-dom
/**
 * The module rail as rendered.
 *
 * fit.test.ts proves the arithmetic and model.test.ts the grouping. This proves
 * the rail draws what they decide: the phone grid caps at three tiles plus
 * "All N modules", the module somebody is in is always on screen however far
 * down the list it sits, section headings appear only once there are enough
 * modules to need them and never twice for one section, and the invisible
 * measuring copy adds no second set of links for a screen reader or a test.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ModuleSection } from "@/platform/modules";
import type { ShellModule } from "./model";
import { ModuleRail } from "./ModuleRail";

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

const mod = (key: string, section: ModuleSection = "Company"): ShellModule => ({
  key,
  name: `${key} module`,
  short: key,
  section,
  tabs: [{ id: "main", label: "Main", to: `/app/${key}`, group: "main" }],
  hiddenForRole: 0,
});

const many = (n: number) => Array.from({ length: n }, (_, i) => mod(`m${i + 1}`));

const railLinks = () =>
  screen.getAllByRole("link").filter((a) => a.getAttribute("data-testid")?.startsWith("rail-"));

describe("grid mode, below 540px", () => {
  it("with five modules shows three tiles and 'All 5 modules', not four or five tiles", () => {
    render(<ModuleRail modules={many(5)} activeKey="m1" mode="grid" brand={null} />);
    expect(railLinks().map((a) => a.dataset.testid)).toEqual(["rail-m1", "rail-m2", "rail-m3"]);
    expect(screen.getByTestId("rail-overflow")).toHaveTextContent("All 5 modules");
  });

  it("four modules fill the grid with no overflow control", () => {
    render(<ModuleRail modules={many(4)} activeKey="m1" mode="grid" brand={null} />);
    expect(railLinks()).toHaveLength(4);
    expect(screen.queryByTestId("rail-overflow")).toBeNull();
  });

  it("the active module is on screen even when it is the twelfth", () => {
    render(<ModuleRail modules={many(12)} activeKey="m12" mode="grid" brand={null} />);
    expect(screen.getByTestId("rail-m12")).toHaveAttribute("aria-current", "page");
    // Still three tiles: the active one displaced another, it did not add a fourth.
    expect(railLinks()).toHaveLength(3);
    expect(screen.getByTestId("rail-overflow")).toHaveTextContent("All 12 modules");
  });
});

describe("column mode, above 1000px", () => {
  const sections: ModuleSection[] = ["Company", "Time", "People", "Time", "Money", "People"];

  it("six modules get no section headings", () => {
    render(
      <ModuleRail
        modules={sections.map((s, i) => mod(`m${i + 1}`, s))}
        activeKey="m1"
        mode="column"
        brand={null}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Modules" });
    expect(Array.from(nav.querySelectorAll("p")).map((p) => p.textContent)).toEqual([]);
    expect(railLinks()).toHaveLength(6);
  });

  it("seven modules out of section order get each section's heading exactly once", () => {
    const seven = [...sections, "Company" as const].map((s, i) => mod(`m${i + 1}`, s));
    render(<ModuleRail modules={seven} activeKey="m1" mode="column" brand={null} />);
    const nav = screen.getByRole("navigation", { name: "Modules" });
    const headings = Array.from(nav.querySelectorAll("p")).map((p) => p.textContent);
    expect(headings).toEqual(["Company", "Time", "People", "Money"]);
    expect(railLinks()).toHaveLength(7);
  });
});

describe("row mode, the measuring copy", () => {
  it("is hidden from assistive technology and holds no links", () => {
    const { container } = render(
      <ModuleRail modules={many(6)} activeKey="m4" mode="row" brand={null} />,
    );
    const chips = container.querySelectorAll("[data-chip]");
    expect(chips).toHaveLength(6);
    for (const chip of chips) {
      expect(
        chip.closest('[aria-hidden="true"]'),
        "aria-hidden ancestor of a measuring chip",
      ).not.toBeNull();
      expect(chip.tagName).not.toBe("A");
      expect(chip.querySelector("a")).toBeNull();
    }
  });

  it("never yields a second rail-<key> test id or a second link for one module", () => {
    render(<ModuleRail modules={many(6)} activeKey="m4" mode="row" brand={null} />);
    for (let i = 1; i <= 6; i++) {
      expect(
        screen.queryAllByTestId(`rail-m${i}`).length,
        `copies of rail-m${i}`,
      ).toBeLessThanOrEqual(1);
    }
    // The active one is drawn, once.
    expect(screen.getAllByTestId("rail-m4")).toHaveLength(1);
    const hrefs = screen.getAllByRole("link", { hidden: true }).map((a) => a.getAttribute("href"));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

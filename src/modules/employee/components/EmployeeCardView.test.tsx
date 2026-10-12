// @vitest-environment happy-dom

/**
 * The Employee Card, rendered from what the database actually sent each role.
 *
 * `__fixtures__/cards.json` is real `employee_card()` output, captured by
 * neuvto-harness/tools/employee_card_fixtures.sql, so these tests cannot pass
 * on a shape the database never produces. What they pin:
 *
 * - a sub-tab exists only when its data arrived: a colleague gets Overview and
 *   Employment, never Personal, Family or History;
 * - the police-station cell is absent, not "—", for somebody not sent it;
 * - the approver sees whom to call and not where the person lives;
 * - archived history rows are muted and carry no control at all (§8.2);
 * - the family count reads the way the design writes it;
 * - the tablist moves with the arrow keys.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

// The card loads a person's own change requests and who has looked at their
// restricted data. Neither is what these tests are about; both answer empty.
vi.mock("../handlers", () => ({
  listChangeRequests: vi.fn().mockResolvedValue([]),
  getRestrictedReads: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;

function tabNames() {
  return screen.getAllByRole("tab").map((t) => t.textContent);
}

describe("EmployeeCardView", () => {
  it("gives a colleague the work card only: two tabs, no police station, no emergency contact", () => {
    render(<EmployeeCardView card={as("colleague")} />);
    expect(tabNames()).toEqual(["Overview", "Employment"]);
    expect(
      within(screen.getByTestId("card-strip")).queryByText("Nearest police station"),
    ).toBeNull();
    expect(screen.queryByTestId("panel-emergency")).toBeNull();
    expect(screen.queryByText("Personal email")).toBeNull();
    // The header names the person and where they work.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Priya Employee");
    expect(screen.getByText(/deployed to Tata AIG, Hosur/)).toBeInTheDocument();
  });

  it("gives you every tab of your own card, with the age worked out", async () => {
    const user = userEvent.setup();
    render(<EmployeeCardView card={as("self")} />);
    expect(tabNames()).toEqual([
      "Overview",
      "Personal",
      "Family",
      "Employment",
      "Statutory and bank",
      "History",
    ]);
    expect(within(screen.getByTestId("card-strip")).getByText("Yelahanka")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Personal" }));
    expect(screen.getByText("12 Jun 1994")).toBeInTheDocument();
    expect(screen.getByText(/\(worked out\)/)).toBeInTheDocument();
  });

  it("shows the approver whom to call, and not where the person lives", () => {
    render(<EmployeeCardView card={as("approver")} />);
    expect(tabNames()).toEqual(["Overview", "Employment"]);
    expect(within(screen.getByTestId("panel-emergency")).getByText("Lakshmi")).toBeInTheDocument();
    expect(screen.queryByText(/Brigade Meadows/)).toBeNull();
    expect(
      within(screen.getByTestId("card-strip")).queryByText("Nearest police station"),
    ).toBeNull();
  });

  it("gives payroll family and history, but not personal details", () => {
    render(<EmployeeCardView card={as("payroll")} />);
    expect(tabNames()).toEqual([
      "Overview",
      "Family",
      "Employment",
      "Statutory and bank",
      "History",
    ]);
  });

  it("mutes archived history and puts no control in an archived row", async () => {
    const user = userEvent.setup();
    render(<EmployeeCardView card={as("admin")} />);
    await user.click(screen.getByRole("tab", { name: "History" }));

    const rows = within(screen.getByTestId("address-history")).getAllByRole("row").slice(1);
    const archived = rows.find((r) => r.textContent?.includes("Mysuru"))!;
    const current = rows.find((r) => r.textContent?.includes("Bengaluru"))!;
    expect(archived).toHaveAttribute("data-muted", "true");
    expect(archived).toHaveTextContent("Archived");
    expect(within(archived).queryAllByRole("button")).toHaveLength(0);
    expect(current).not.toHaveAttribute("data-muted");
    expect(current).toHaveTextContent("Current");

    const postings = within(screen.getByTestId("deployment-history")).getAllByRole("row").slice(1);
    // April 2024 to May 2025, both months whole, is a year and two months.
    expect(postings.find((r) => r.textContent?.includes("Acme HQ"))).toHaveTextContent("1 yr 2 mo");
  });

  it("counts the family the way the design writes it", async () => {
    const user = userEvent.setup();
    render(<EmployeeCardView card={as("self")} />);
    await user.click(screen.getByRole("tab", { name: "Family" }));
    expect(screen.getByTestId("family-summary")).toHaveTextContent("2 sons, 1 daughter");
    expect(screen.getByText("Shares total 100%")).toBeInTheDocument();
  });

  it("moves between sub-tabs with the arrow keys, and only one is in the tab order", async () => {
    const user = userEvent.setup();
    render(<EmployeeCardView card={as("self")} />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    await user.keyboard("{ArrowRight}");
    const personal = screen.getByRole("tab", { name: "Personal" });
    expect(personal).toHaveAttribute("aria-selected", "true");
    expect(personal).toHaveFocus();
    expect(overview).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  });
});

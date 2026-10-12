// @vitest-environment happy-dom

/**
 * Criterion 8: every source column has a home in the UI, and the catalogue is
 * the checklist. This runs the checklist.
 *
 * - every column of the real master sheet is in the catalogue, once;
 * - every home is a real panel on a real tab of a real card. The card is
 *   rendered from employee_card() output for the person themselves (the one
 *   role that receives every block), each tab is opened, and the panel titles
 *   are read off the screen. A home naming a panel that does not exist fails.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeCard } from "../contracts";
import { FIELD_CATALOGUE, SOURCE_COLUMNS } from "../fieldCatalogue";
import { MASTER_SHEET_HEADERS, normaliseHeader } from "../masterSheet";
import cards from "./__fixtures__/cards.json";

vi.mock("../handlers", () => ({
  listChangeRequests: vi.fn().mockResolvedValue([]),
  getRestrictedReads: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

/** The real master sheet's columns, each once (the sheet repeats two). */
const INVENTORY = [...new Set(MASTER_SHEET_HEADERS.map(normaliseHeader))];

describe("the field catalogue", () => {
  it("places every column of the inventory, once", () => {
    expect([...SOURCE_COLUMNS].map(normaliseHeader).sort()).toEqual([...INVENTORY].sort());
    expect(new Set(SOURCE_COLUMNS).size).toBe(SOURCE_COLUMNS.length);
  });

  it("gives every field a home that is really on the card", async () => {
    const user = userEvent.setup();
    render(<EmployeeCardView card={cards.self as unknown as EmployeeCard} />);
    const panelsByTab = new Map<string, Set<string>>();
    for (const tab of screen.getAllByRole("tab")) {
      await user.click(tab);
      panelsByTab.set(
        tab.textContent ?? "",
        new Set(
          [...screen.getByRole("tabpanel").querySelectorAll("h3")].map((h) => h.textContent ?? ""),
        ),
      );
    }

    const homeless = FIELD_CATALOGUE.filter((c) => {
      if (c.home === "Card header") return !screen.getByTestId("card-header");
      return !panelsByTab.get(c.home.tab)?.has(c.home.panel);
    }).map(
      (c) =>
        `${c.field} → ${c.home === "Card header" ? c.home : `${c.home.tab} › ${c.home.panel}`}`,
    );
    expect(homeless).toEqual([]);
  });
});

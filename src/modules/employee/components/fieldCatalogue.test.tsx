// @vitest-environment happy-dom

/**
 * Criterion 8: every source column has a home in the UI, and the catalogue is
 * the checklist. This runs the checklist.
 *
 * - every column the bundle's inventory names is in the catalogue, once;
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
import cards from "./__fixtures__/cards.json";

vi.mock("../handlers", () => ({
  listChangeRequests: vi.fn().mockResolvedValue([]),
  getRestrictedReads: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

/** The bundle's "Full field inventory", column by column (02-data-model.md). */
const INVENTORY = [
  "EMPLOYEE ID",
  "EMPLOYEE NAME",
  "Sex",
  "DATE OF BIRTH",
  "AGE",
  "MARITAL -STATUS",
  "NATIONALITY",
  "Native from which state",
  "BLOOD GROUP",
  "Education Qualification",
  "Mobile / Phone No",
  "EMERGENCY CONTACT",
  "NEAREST POLICE STATION",
  "PRESENT ADDRESS",
  "PERMANENT ADDRESS",
  "DESIGNATION",
  "DATE OF JOINING",
  "RE-JOINING DATE",
  "STATUS",
  "EMPLOYMENT TERMINATION",
  "TOTAL EXPERIENCE",
  "REASON FOR LEAVING LAST ORG",
  "Deputation / Deployed Unit",
  "FATHER NAME",
  "FATHER DOB",
  "MOTHER",
  "MOTHER DOB",
  "HUSBAND NAME",
  "HUSBAND DOB",
  "WIFE",
  "WIFE DOB",
  "SON 1",
  "SON 2",
  "DAUGHTER 1",
  "DAUGHTER 2",
  "NOMINEE NAME",
  "RELATION WITH MEMBER",
  "DATE OF BIRTH OF NOMINEE",
  "UAN",
  "EPF NUMBER",
  "ESIC NUMBER",
  "OLD EPF UAN NO",
  "OLD ESIC NO",
  "Type of Documents",
  "AADHAAR NO",
  "PAN NO",
  "BANK ACCOUNT NO",
  "IFSC Code",
  "Bank Name",
  "Branch Name",
  "HEIGHT",
  "CHEST",
  "WEIGHT",
  "RELIGION",
  "CASTE",
  "Physically Handicap",
];

describe("the field catalogue", () => {
  it("places every column of the inventory, once", () => {
    expect([...SOURCE_COLUMNS].sort()).toEqual([...INVENTORY].sort());
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

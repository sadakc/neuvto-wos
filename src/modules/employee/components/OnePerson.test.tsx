// @vitest-environment happy-dom

/**
 * D117, one person, one record (Sada, 3 Nov 2026). What it pins:
 *
 * - a nominee can be added from Family, bringing their name, relation and
 *   date of birth, and is sent linked to that family member;
 * - choosing father or mother as a nominee's relation is the one in Family;
 * - Family will not take a second father or mother;
 * - Reports to is not marked required;
 * - the physical record offers heights to 6 ft 6 in, chests 60 to 130 cm,
 *   weights 30 to 150 kg.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(async () => []),
  listDocumentViews: vi.fn(async () => []),
  getThisYear: vi.fn(),
  listCardViews: vi.fn(async () => []),
  listActiveUnits: vi.fn(),
  listDesignations: vi.fn(),
  updateEmployee: vi.fn(),
  saveFamily: vi.fn(),
  saveNomination: vi.fn(),
  getRestrictedReads: vi.fn(),
  listChangeRequests: vi.fn(),
  getAdminOverview: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const admin = as("admin");

beforeEach(() => {
  vi.resetAllMocks();
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.listDesignations.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
  api.listChangeRequests.mockResolvedValue([]);
  api.listActiveUnits.mockResolvedValue([]);
  api.getAdminOverview.mockResolvedValue({ departments: [] });
});

const user = () => userEvent.setup();
async function openTab(name: string) {
  await user().click(screen.getByRole("tab", { name }));
}

const withFamily: EmployeeCard = {
  ...admin,
  familyMembers: [
    {
      id: "f-father",
      relation: "father",
      name: "Ramesh Rao",
      dateOfBirth: "1960-05-01",
      isDependent: true,
    },
    { id: "f-son", relation: "son", name: "Aarav", dateOfBirth: "2015-08-15", isDependent: true },
  ],
  nominations: [],
};

describe("a nominee is a family member", () => {
  it("is added from Family with their details, and sent linked", async () => {
    const u = user();
    api.saveNomination.mockResolvedValue(undefined);
    render(<EmployeeCardView card={withFamily} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-nominees"));
    const pick = screen.getByTestId("nominee-from-family");
    expect(
      within(pick).getByRole("option", { name: "Ramesh Rao (Father, born 01 May 1960)" }),
    ).toBeInTheDocument();
    await u.selectOptions(pick, "f-father");
    expect(screen.getByLabelText("Nominee name, row 1")).toHaveValue("Ramesh Rao");
    // Once nominated, not offered again.
    expect(
      within(screen.getByTestId("nominee-from-family")).queryByRole("option", { name: /Ramesh/ }),
    ).toBeNull();
    await u.type(screen.getByLabelText("Share, row 1"), "100");
    await u.click(screen.getByTestId("nominee-save"));
    expect(api.saveNomination).toHaveBeenCalledWith(
      withFamily.id,
      expect.objectContaining({
        nominees: [
          expect.objectContaining({
            name: "Ramesh Rao",
            relation: "father",
            dateOfBirth: "1960-05-01",
            familyMemberId: "f-father",
          }),
        ],
      }),
    );
  });

  it("is the father in Family when the relation chosen is father", async () => {
    const u = user();
    render(<EmployeeCardView card={withFamily} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-nominees"));
    await u.click(screen.getByTestId("nominee-add-row"));
    const row = screen.getAllByTestId("nominee-editor-row")[0];
    await u.selectOptions(within(row).getByRole("combobox"), "father");
    expect(within(row).getByLabelText("Nominee name, row 1")).toHaveValue("Ramesh Rao");
  });

  it("says a nominee is a member of the family, and changes there too", async () => {
    render(<EmployeeCardView card={withFamily} />);
    await openTab("Family");
    await user().click(screen.getByTestId("edit-nominees"));
    expect(screen.getByTestId("nominee-is-family")).toHaveTextContent("changed in Family");
  });
});

describe("Family", () => {
  it("will not take a second father", async () => {
    const u = user();
    render(<EmployeeCardView card={withFamily} />);
    await openTab("Family");
    await u.click(screen.getByTestId("edit-family"));
    await u.click(screen.getByTestId("family-add-row"));
    const rows = screen.getAllByTestId("family-editor-row");
    const last = rows[rows.length - 1];
    await u.selectOptions(within(last).getByRole("combobox"), "father");
    await u.type(within(last).getByRole("textbox", { name: /name/i }), "Suresh Rao");
    await u.click(screen.getByTestId("family-save"));
    expect(screen.getByRole("alert")).toHaveTextContent("There can be only one father.");
    expect(api.saveFamily).not.toHaveBeenCalled();
  });
});

describe("Reports to", () => {
  it("is not marked required (the CEO reports to nobody)", async () => {
    render(<EmployeeCardView card={admin} />);
    await openTab("Employment");
    await user().click(screen.getByTestId("edit-position"));
    const form = screen.getByTestId("editor-position");
    expect(within(form).getByText("Reports to")).not.toHaveAttribute("data-required");
  });
});

describe("the physical record's lists", () => {
  it("run to 6 ft 6 in, 130 cm chest and 150 kg", async () => {
    render(<EmployeeCardView card={admin} />);
    await openTab("Personal");
    await user().click(screen.getByTestId("edit-physical"));
    const last = (name: string) => {
      const opts = within(screen.getByRole("combobox", { name })).getAllByRole("option");
      return opts[opts.length - 1].textContent;
    };
    expect(last("Height")).toBe("198 cm (6′ 6″)");
    expect(last("Chest")).toBe("130 cm");
    expect(last("Weight")).toBe("150 kg");
  });
});

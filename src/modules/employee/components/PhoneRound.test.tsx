// @vitest-environment happy-dom

/**
 * D113, what Sada found testing on his phone (14 Oct 2026), against real
 * employee_card() output. What it pins:
 *
 * - a required field's label carries a red asterisk, and only a required one;
 *   the label's text stays the field's name;
 * - the nearest police station is shown in Physical record, whose editor it is in;
 * - a first posting still to come is shown in full, in the panel and the strip,
 *   as starting, not as nothing;
 * - a draft's details are edited from a button like its neighbours, not a link.
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

/** The label element whose text is `name`, wherever the form puts it. */
const labelOf = (form: HTMLElement, name: string) =>
  within(form)
    .getAllByText(name)
    .find((el) => el.closest("label, fieldset, div"))!;

describe("a required field is marked", () => {
  it("with an asterisk on its label, and an optional one without", async () => {
    render(<EmployeeCardView card={{ ...admin, dateOfBirth: null }} />);
    await openTab("Personal");
    await user().click(screen.getByTestId("edit-identity"));
    const form = screen.getByTestId("editor-identity");
    expect(labelOf(form, "Date of birth")).toHaveAttribute("data-required", "true");
    expect(labelOf(form, "Native state")).not.toHaveAttribute("data-required");
    // Still called by its name.
    expect(within(form).getByRole("combobox", { name: "Native state" })).toBeInTheDocument();
  });

  it("in the deploy dialog: the unit, the date and the order reference", async () => {
    render(<EmployeeCardView card={admin} />);
    await user().click(screen.getByTestId("move-unit"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Move to")).toHaveAttribute("data-required", "true");
    expect(within(dialog).getByText("Deployment order reference")).toHaveAttribute(
      "data-required",
      "true",
    );
    expect(within(dialog).getByText("Starts at the new unit on")).toHaveAttribute(
      "data-required",
      "true",
    );
    expect(within(dialog).getByText("Reason for deploying")).not.toHaveAttribute("data-required");
  });
});

describe("the nearest police station", () => {
  it("is shown in Physical record, beside the editor it is in", async () => {
    render(<EmployeeCardView card={admin} />);
    await openTab("Personal");
    const panel = screen.getByText("Physical record").closest("section")!;
    expect(panel).toHaveTextContent("Nearest police station");
    expect(panel).toHaveTextContent(admin.nearestPoliceStation!);
  });
});

describe("a first posting still to come (Kavya)", () => {
  const kavya: EmployeeCard = {
    ...admin,
    currentDeployment: null,
    nextDeployment: { unitName: "Security", effectiveFrom: "2026-10-17", unitType: "client_site" },
  };

  it("is shown in the panel as starting, with its unit and type", () => {
    render(<EmployeeCardView card={kavya} />);
    const panel = screen.getByTestId("panel-deployment");
    expect(panel).toHaveTextContent("UnitSecurity");
    expect(panel).toHaveTextContent("Client site");
    expect(panel).toHaveTextContent("Starts on17 Oct 2026");
    expect(panel).not.toHaveTextContent("Moving to");
  });

  it("is in the strip at the top, not a dash", () => {
    render(<EmployeeCardView card={kavya} />);
    const strip = screen.getByText("Deployed unit").parentElement!;
    expect(strip).toHaveTextContent("Security from 17 Oct 2026");
    // Wrapped, never cut to "Security from 17 Oc…" on a phone.
    const value = within(strip).getByText("Security from 17 Oct 2026");
    expect(value.className).not.toContain("truncate");
  });

  it("still reads as a move when there is a posting now", () => {
    render(
      <EmployeeCardView
        card={{ ...admin, nextDeployment: { unitName: "Security", effectiveFrom: "2026-10-17" } }}
      />,
    );
    const panel = screen.getByTestId("panel-deployment");
    expect(panel).toHaveTextContent(`Unit${admin.currentDeployment!.unitName}`);
    expect(panel).toHaveTextContent("Moving toSecurity from 17 Oct 2026");
  });
});

describe("a draft's details", () => {
  it("are edited from a button like its neighbours, not a link in between", () => {
    render(<EmployeeCardView card={as("draft")} />);
    const actions = screen.getByTestId("lifecycle-actions");
    const edit = within(actions).getByRole("button", { name: "Edit details" });
    expect(edit.className).toContain("rounded-md");
    expect(edit.className).toContain("border");
    expect(edit.className).not.toContain("hover:underline");
  });
});

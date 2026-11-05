// @vitest-environment happy-dom

/**
 * Doc 11.4, a person's record on a phone (under 600px, inside the phone
 * shell): the header and an index of its sections, then one section alone.
 * Never the row of tabs. Above 600px, the tabs as before.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneProvider } from "@/platform/shell";
import { AnchorContext } from "@/platform/shell/anchor";
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

const onPhone = (card: EmployeeCard) =>
  render(
    <PhoneProvider phone>
      <EmployeeCardView card={card} />
    </PhoneProvider>,
  );

describe("a person's record on a phone", () => {
  it("opens on its header and an index of its sections, with no tab row", () => {
    onPhone(admin);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("card-header")).toBeInTheDocument();
    for (const id of ["overview", "personal", "family", "employment", "history"]) {
      expect(screen.getByTestId(`record-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("record-personal")).toHaveTextContent(
      "Identity, education, physical record",
    );
    // Nothing of a section shows on the index.
    expect(screen.queryByText("Physical record")).toBeNull();
  });

  it("shows one section alone once chosen, without the header", async () => {
    const user = userEvent.setup();
    onPhone(admin);
    await user.click(screen.getByTestId("record-personal"));
    expect(screen.getByTestId("record-section")).toHaveTextContent("Physical record");
    expect(screen.queryByTestId("card-header")).toBeNull();
    expect(screen.queryByTestId("record-overview")).toBeNull();
  });

  it("offers only the sections the viewer may open", () => {
    onPhone(as("colleague"));
    expect(screen.queryByTestId("record-statutory")).toBeNull();
    expect(screen.queryByTestId("record-documents")).toBeNull();
  });

  it("is the tab row as before above 600px", () => {
    render(<EmployeeCardView card={admin} />);
    expect(screen.getByRole("tablist", { name: "Record sections" })).toBeInTheDocument();
    expect(screen.queryByTestId("record-overview")).toBeNull();
  });
});

describe("a notice's anchor on the record (Sada, 27 Oct 2026)", () => {
  const anchored = (anchor: string, card: EmployeeCard = as("self")) =>
    render(
      <AnchorContext.Provider value={anchor}>
        <PhoneProvider phone>
          <EmployeeCardView card={card} />
        </PhoneProvider>
      </AnchorContext.Provider>,
    );

  it("opens Overview, where the person's change requests are, for an answered request", async () => {
    anchored("my-change-requests");
    expect(screen.getByTestId("record-section")).toBeInTheDocument();
    expect(document.getElementById("my-change-requests")).not.toBeNull();
  });

  it("opens the section a reminder names", () => {
    anchored("section-family", admin);
    expect(screen.getByTestId("record-section")).toHaveTextContent("Nominees");
  });

  it("opens the tab on a laptop too", () => {
    render(
      <AnchorContext.Provider value="section-family">
        <EmployeeCardView card={admin} />
      </AnchorContext.Provider>,
    );
    expect(screen.getByRole("tab", { name: "Family" })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores an anchor for a section the viewer may not open", () => {
    anchored("section-statutory", as("colleague"));
    expect(screen.queryByTestId("record-section")).toBeNull();
  });

  it("leaves the section open alone for an anchor that names none of its sections", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AnchorContext.Provider value="">
        <EmployeeCardView card={admin} />
      </AnchorContext.Provider>,
    );
    await user.click(screen.getByRole("tab", { name: "Family" }));
    rerender(
      <AnchorContext.Provider value="leave-r1">
        <EmployeeCardView card={admin} />
      </AnchorContext.Provider>,
    );
    expect(screen.getByRole("tab", { name: "Family" })).toHaveAttribute("aria-selected", "true");
  });
});

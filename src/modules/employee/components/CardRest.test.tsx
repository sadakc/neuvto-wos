// @vitest-environment happy-dom

/**
 * The rest of the Employee Card (D97, D98, D100), against real employee_card()
 * output. What it pins:
 *
 * - "This year" asks for the year only for those the card says may see it,
 *   shows leave left of each kind and what the person is waiting on, and
 *   leaves out leave when Leave is off;
 * - "Who has looked" is offered to the person and a Super Admin only, and
 *   lists the looks;
 * - a proof on an address: the current row opens it through the logged open
 *   and replaces it; an archived row says it is on file and has no control;
 *   the Statutory role, which sees addresses, sees no proof column at all;
 * - adding an address with a proof files the proof against the row added for
 *   the type chosen, not the permanent copy;
 * - address proofs are on the Documents tab, where any of them can be opened.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  listChangeRequests: vi.fn(),
  getRestrictedReads: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentViews: vi.fn(),
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  openDocument: vi.fn(),
  attachAddressProof: vi.fn(),
  addAddress: vi.fn(),
  listDesignations: vi.fn(),
  listActiveUnits: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("../recordExport", () => ({ downloadRecordPdf: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;

const YEAR = {
  leaveYear: "2026-27",
  leave: [
    {
      leaveTypeId: "t1",
      name: "Casual",
      kind: "paid",
      entitled: 12,
      used: 2,
      pending: 1.5,
      available: 10,
    },
    {
      leaveTypeId: "t2",
      name: "Compensatory off",
      kind: "earned",
      entitled: 1,
      used: 0,
      pending: 0,
      available: 1,
    },
  ],
  openRequests: [
    { label: "Leave request", count: 2 },
    { label: "Compensatory off claim", count: 1 },
  ],
  openCorrections: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listChangeRequests.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
  api.listDocuments.mockResolvedValue([]);
  api.listDocumentViews.mockResolvedValue([]);
  api.getThisYear.mockResolvedValue(YEAR);
  api.listCardViews.mockResolvedValue([]);
  api.listDesignations.mockResolvedValue([]);
  api.openDocument.mockResolvedValue("https://signed.example/proof.pdf");
});

async function openTab(name: string) {
  await userEvent.setup().click(screen.getByRole("tab", { name }));
}

describe("this year", () => {
  it("shows leave left of each kind and what the person is waiting on", async () => {
    const card = as("self");
    render(<EmployeeCardView card={card} />);
    const panel = await screen.findByTestId("panel-this-year");
    expect(api.getThisYear).toHaveBeenCalledWith(card.id);
    expect(await within(panel).findByText("Casual")).toBeInTheDocument();
    expect(panel).toHaveTextContent("10 of 12 days left");
    expect(panel).toHaveTextContent("1.5 awaiting a decision");
    expect(panel).toHaveTextContent("1 of 1 day left");
    expect(panel).toHaveTextContent("Leave request: 2");
    expect(panel).toHaveTextContent("Compensatory off claim: 1");
    expect(panel).toHaveTextContent("Record corrections: 1");
  });

  it("says when nothing is waiting, and leaves leave out when Leave is off", async () => {
    api.getThisYear.mockResolvedValue({
      leaveYear: null,
      leave: null,
      openRequests: [],
      openCorrections: 0,
    });
    render(<EmployeeCardView card={as("approver")} />);
    const panel = await screen.findByTestId("panel-this-year");
    expect(await within(panel).findByText("Nothing waiting on a decision.")).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("days left");
  });

  it("is not asked for, or shown, where the card does not allow it", async () => {
    render(<EmployeeCardView card={as("colleague")} />);
    await screen.findByTestId("panel-contact");
    expect(screen.queryByTestId("panel-this-year")).toBeNull();
    expect(api.getThisYear).not.toHaveBeenCalled();
  });

  it("says so when it cannot load", async () => {
    api.getThisYear.mockRejectedValue(new Error("down"));
    render(<EmployeeCardView card={as("self")} />);
    expect(
      await within(await screen.findByTestId("panel-this-year")).findByText(
        /couldn't load this year/,
      ),
    ).toBeInTheDocument();
  });
});

describe("who has looked", () => {
  it("lists who opened the record, for the person", async () => {
    const user = userEvent.setup();
    api.listCardViews.mockResolvedValue([
      { viewerName: "Dan Director", viewedAt: "2026-10-12T09:00:00Z" },
    ]);
    const card = as("self");
    render(<EmployeeCardView card={card} />);
    await user.click(screen.getByRole("button", { name: "Who has looked at this record" }));
    expect(api.listCardViews).toHaveBeenCalledWith(card.id);
    expect(await screen.findByText(/Dan Director/)).toHaveTextContent(
      "Dan Director looked on 12 Oct 2026",
    );
  });

  it("is not offered to the Employee Admin", () => {
    render(<EmployeeCardView card={as("employeeAdmin")} />);
    expect(screen.queryByRole("button", { name: "Who has looked at this record" })).toBeNull();
  });
});

describe("proof on an address", () => {
  const rowWith = (text: string) =>
    within(screen.getByTestId("address-history"))
      .getAllByRole("row")
      .find((r) => r.textContent?.includes(text))!;

  it("opens the current address's proof through the logged open", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const card = as("self");
    const proof = card.addresses!.find((a) => a.proof)!.proof!;
    render(<EmployeeCardView card={card} />);
    await openTab("History");
    const current = rowWith("Brigade Meadows");
    expect(current).toHaveTextContent("rent-agreement.pdf");
    await user.click(within(current).getByRole("button", { name: "View proof" }));
    expect(api.openDocument).toHaveBeenCalledWith(proof.documentId);
    expect(open).toHaveBeenCalledWith("https://signed.example/proof.pdf", "_blank", "noopener");
  });

  it("replaces the current address's proof, and refreshes the card", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const card = as("employeeAdmin");
    const current = card.addresses!.find((a) => !a.effectiveTo)!;
    api.attachAddressProof.mockResolvedValue("doc-new");
    render(<EmployeeCardView card={card} onChanged={onChanged} />);
    await openTab("History");
    await user.click(
      within(rowWith("Brigade Meadows")).getByRole("button", { name: "Replace proof" }),
    );
    const file = new File(["%PDF-1.4"], "lease.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Proof of address"), file);
    await user.click(screen.getByRole("button", { name: "Attach" }));
    expect(api.attachAddressProof).toHaveBeenCalledWith({
      employeeId: card.id,
      addressId: current.id,
      file,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("puts no control on an archived row, and says what is on file", async () => {
    render(<EmployeeCardView card={as("self")} />);
    await openTab("History");
    const archived = rowWith("Mysuru");
    expect(archived).toHaveTextContent("None");
    expect(within(archived).queryAllByRole("button")).toHaveLength(0);
  });

  it("gives the Statutory role no proof column", async () => {
    render(<EmployeeCardView card={as("statutory")} />);
    await openTab("History");
    expect(within(screen.getByTestId("address-history")).queryByText("Proof")).toBeNull();
    expect(screen.queryByRole("button", { name: /proof/i })).toBeNull();
  });

  it("files a proof given with a new address against the row for that type", async () => {
    const user = userEvent.setup();
    const card = as("employeeAdmin");
    api.addAddress.mockResolvedValue([
      { id: "addr-present", addressType: "present" },
      { id: "addr-permanent", addressType: "permanent" },
    ]);
    api.attachAddressProof.mockResolvedValue("doc-1");
    render(<EmployeeCardView card={card} />);
    await openTab("History");
    await user.click(screen.getByTestId("add-address"));
    await user.type(screen.getByTestId("address-line"), "9 Lake View");
    await user.type(screen.getByTestId("address-city"), "Hosur");
    await user.type(screen.getByTestId("address-state"), "Tamil Nadu");
    await user.type(screen.getByTestId("address-pincode"), "635109");
    const file = new File(["%PDF-1.4"], "bill.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Proof (optional)"), file);
    await user.click(screen.getByTestId("address-save"));
    expect(api.attachAddressProof).toHaveBeenCalledWith({
      employeeId: card.id,
      addressId: "addr-present",
      file,
    });
  });

  it("keeps the address when the proof fails, and says how to attach it", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    api.addAddress.mockResolvedValue([{ id: "addr-present", addressType: "present" }]);
    api.attachAddressProof.mockRejectedValue(new Error("storage down"));
    render(<EmployeeCardView card={as("employeeAdmin")} onChanged={onChanged} />);
    await openTab("History");
    await user.click(screen.getByTestId("add-address"));
    await user.type(screen.getByTestId("address-line"), "9 Lake View");
    await user.type(screen.getByTestId("address-city"), "Hosur");
    await user.type(screen.getByTestId("address-state"), "Tamil Nadu");
    await user.type(screen.getByTestId("address-pincode"), "635109");
    await user.upload(
      screen.getByLabelText("Proof (optional)"),
      new File(["x"], "bill.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByTestId("address-save"));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByTestId("address-proof-failed")).toHaveTextContent(
      "The address was saved, but the proof didn't attach. Attach it from the address row.",
    );
  });
});

describe("address proofs on the Documents tab", () => {
  it("lists each proof with the twelve, and opens it through the logged open", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "open").mockImplementation(() => null);
    api.listDocuments.mockResolvedValue([
      {
        id: "ap1",
        docType: "address_proof",
        title: null,
        fileName: "old-bill.pdf",
        sizeBytes: 100,
        uploadedAt: "2026-08-02T09:00:00Z",
        uploadedBy: "Hema HR",
        expiresOn: null,
        verifiedAt: null,
        verifiedBy: null,
        status: "uploaded",
      },
    ]);
    render(<EmployeeCardView card={as("self")} />);
    await openTab("Documents");
    const row = (await screen.findByText("Address proof, old-bill.pdf")).closest(
      '[data-testid="document-row"]',
    ) as HTMLElement;
    expect(screen.getAllByTestId("document-row")).toHaveLength(13);
    await user.click(within(row).getByRole("button", { name: "View" }));
    expect(api.openDocument).toHaveBeenCalledWith("ap1");
    // It is attached from an address, never uploaded here.
    await user.click(screen.getByRole("button", { name: "Upload a document" }));
    expect(
      within(screen.getByLabelText("Document")).queryByRole("option", { name: /Address proof/ }),
    ).toBeNull();
  });
});

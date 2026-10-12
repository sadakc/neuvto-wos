// @vitest-environment happy-dom

/**
 * The card's Documents tab (D95). What it pins:
 *
 * - all twelve documents are listed, each on file with its upload date,
 *   expiry and status, or "Not submitted"; each employer's relieving letter
 *   on its own row;
 * - uploading sends exactly the document, its name where one is needed, its
 *   expiry, and the file;
 * - opening goes through the logged open, never straight to storage;
 * - verifying and removing are offered to the Employee Admin only, never on
 *   their own record, and removing asks why;
 * - the tab says that every opening is logged.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  verifyDocument: vi.fn(),
  removeDocument: vi.fn(),
  openDocument: vi.fn(),
  listDocumentViews: vi.fn(),
}));
vi.mock("../handlers", () => h);

import { DocumentsTab } from "./DocumentsTab";

const doc = (o: Record<string, unknown>) => ({
  id: "d",
  title: null,
  fileName: "file.pdf",
  sizeBytes: 2048,
  uploadedAt: "2026-08-02T09:00:00Z",
  uploadedBy: "Ravi Employee",
  expiresOn: null,
  verifiedAt: null,
  verifiedBy: null,
  status: "uploaded",
  ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  h.listDocuments.mockResolvedValue([
    doc({ id: "a1", docType: "aadhaar", status: "verified", verifiedBy: "Dan Director" }),
    doc({ id: "p1", docType: "police_verification", expiresOn: "2027-08-21" }),
    doc({ id: "r1", docType: "relieving_letter", title: "Tessellate" }),
    doc({ id: "r2", docType: "relieving_letter", title: "Mysore Tooling", status: "expired" }),
  ]);
  h.listDocumentViews.mockResolvedValue([]);
  h.uploadDocument.mockResolvedValue("new");
  h.openDocument.mockResolvedValue("https://signed.example/file.pdf");
});

const rowFor = async (name: string | RegExp) =>
  (await screen.findByText(name)).closest('[data-testid="document-row"]') as HTMLElement;

describe("the documents on a record", () => {
  it("lists all twelve, what is on file with its dates and status, and what is not submitted", async () => {
    render(<DocumentsTab employeeId="e1" isAdmin={false} isSelf />);
    expect(await rowFor("Aadhaar card")).toHaveTextContent(
      "Statutory · uploaded 2 Aug 2026 · Verified by Dan Director",
    );
    expect(await rowFor("Police verification report")).toHaveTextContent("expires 21 Aug 2027");
    expect(await rowFor("Relieving letter, Tessellate")).toHaveTextContent("Uploaded");
    expect(await rowFor("Relieving letter, Mysore Tooling")).toHaveTextContent("Expired");
    expect(await rowFor("PAN card")).toHaveTextContent("Not submitted");
    // Twelve types; two relieving letters on file: thirteen rows.
    expect(screen.getAllByTestId("document-row")).toHaveLength(13);
    expect(
      screen.getByText(
        /Every time a document is opened, it is logged against the name of whoever opened it/,
      ),
    ).toBeInTheDocument();
  });

  it("uploads exactly the document, its name, its expiry and the file", async () => {
    const user = userEvent.setup();
    render(<DocumentsTab employeeId="e1" isAdmin={false} isSelf />);
    await user.click(await screen.findByRole("button", { name: "Upload a document" }));
    await user.selectOptions(screen.getByLabelText("Document"), "relieving_letter");
    await user.type(screen.getByLabelText("Which employer"), "Securitas");
    await user.type(screen.getByLabelText("Expires on (optional)"), "2030-01-01");
    const file = new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("File"), file);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(h.uploadDocument).toHaveBeenCalledWith({
      employeeId: "e1",
      docType: "relieving_letter",
      title: "Securitas",
      expiresOn: "2030-01-01",
      file,
    });
  });

  it("opens through the logged open", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<DocumentsTab employeeId="e1" isAdmin={false} isSelf />);
    await user.click(within(await rowFor("Aadhaar card")).getByRole("button", { name: "View" }));
    expect(h.openDocument).toHaveBeenCalledWith("a1");
    expect(open).toHaveBeenCalledWith("https://signed.example/file.pdf", "_blank", "noopener");
  });

  it("offers the person no verify or remove", async () => {
    render(<DocumentsTab employeeId="e1" isAdmin={false} isSelf />);
    const row = await rowFor("Police verification report");
    expect(within(row).queryByRole("button", { name: "Verify" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("lets the Employee Admin verify, and remove with a reason, on somebody else's record", async () => {
    const user = userEvent.setup();
    render(<DocumentsTab employeeId="e1" isAdmin isSelf={false} />);
    const row = await rowFor("Police verification report");
    await user.click(within(row).getByRole("button", { name: "Verify" }));
    expect(h.verifyDocument).toHaveBeenCalledWith("p1");
    expect(
      within(await rowFor("Aadhaar card")).queryByRole("button", { name: "Verify" }),
    ).toBeNull();
    await user.click(
      within(await rowFor("Police verification report")).getByRole("button", { name: "Remove" }),
    );
    await user.type(screen.getByLabelText("Why is it being removed?"), "Wrong person's scan");
    await user.click(screen.getByRole("button", { name: "Remove the document" }));
    expect(h.removeDocument).toHaveBeenCalledWith("p1", "Wrong person's scan");
  });

  it("offers the Employee Admin no verify on their own record", async () => {
    render(<DocumentsTab employeeId="e1" isAdmin isSelf />);
    const row = await rowFor("Police verification report");
    expect(within(row).queryByRole("button", { name: "Verify" })).toBeNull();
  });
});

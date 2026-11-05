// @vitest-environment happy-dom

/**
 * D113: attaching a proof with no file chosen is said on pressing Attach, and
 * nothing is sent. The button is never greyed out for it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ attachAddressProof: vi.fn(), openDocument: vi.fn() }));
vi.mock("../handlers", () => api);

import { AttachProofForm } from "./AddressProof";

beforeEach(() => {
  vi.resetAllMocks();
  api.attachAddressProof.mockResolvedValue(undefined);
});

describe("attaching a proof of address", () => {
  it("says a file is needed on pressing Attach, then attaches the one chosen", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<AttachProofForm employeeId="e1" addressId="a1" onDone={onDone} onCancel={() => {}} />);
    const attach = screen.getByRole("button", { name: "Attach" });
    expect(attach).toBeEnabled();
    await user.click(attach);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the proof to attach.");
    expect(api.attachAddressProof).not.toHaveBeenCalled();

    const file = new File(["%PDF-1.4"], "bill.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Proof of address"), file);
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(attach);
    expect(api.attachAddressProof).toHaveBeenCalledWith({
      employeeId: "e1",
      addressId: "a1",
      file,
    });
  });
});

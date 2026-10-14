// @vitest-environment happy-dom

/**
 * D113: the company's registered name, emptied, is said on pressing Save,
 * under the box, and nothing is saved. The button is never greyed out for it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));
vi.mock(".", () => ({
  companyName: (o: { name: string }) => o.name,
  getLogoUrl: async () => null,
  getOrganization: h.getOrganization,
  identityChanged: () => {},
  removeLogo: vi.fn(),
  updateOrganization: h.updateOrganization,
  uploadLogo: vi.fn(),
}));

import { CompanyIdentity } from "./CompanyIdentity";

beforeEach(() => {
  vi.resetAllMocks();
  h.getOrganization.mockResolvedValue({
    id: "org",
    name: "Acme Security Pvt Ltd",
    displayName: "Acme",
    industryType: "Security services",
    slug: "acme",
    logoPath: null,
    logoUpdatedAt: null,
  });
  h.updateOrganization.mockResolvedValue(undefined);
});

describe("the registered company name", () => {
  it("is marked required, and an emptied one is said on pressing Save", async () => {
    const user = userEvent.setup();
    render(<CompanyIdentity />);
    const name = await screen.findByLabelText("Registered company name");
    expect(screen.getByText("Registered company name")).toHaveAttribute("data-required", "true");
    await user.clear(name);
    const save = screen.getByTestId("save-identity");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Registered company name can't be empty.");
    expect(h.updateOrganization).not.toHaveBeenCalled();

    await user.type(name, "Acme Security");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(save);
    expect(h.updateOrganization).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ name: "Acme Security" }),
    );
  });
});

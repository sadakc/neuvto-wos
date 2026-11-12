// @vitest-environment happy-dom

/**
 * The console's Super Admins panel (D83). What it promises:
 *
 * - the only Super Admin cannot be offered for removal;
 * - removing asks once more, and then removes the person the row is about,
 *   while an invitation row withdraws the invitation instead;
 * - a refusal names the reason, and is gone once the next action starts;
 * - adding reports what actually happened and shows the new list.
 */

import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { CompanySuperAdmin } from "./platform";

const api = vi.hoisted(() => ({
  listSuperAdmins: vi.fn(),
  addSuperAdmin: vi.fn(),
  removeSuperAdmin: vi.fn(),
  withdrawSuperAdminInvite: vi.fn(),
}));
vi.mock("./platform", () => api);

import { SuperAdminsPanel } from "./SuperAdminsPanel";

const ORG = "org-1";

function member(id: string, name: string, email: string): CompanySuperAdmin {
  return {
    kind: "member",
    userId: id,
    invitationId: null,
    fullName: name,
    email,
    isActive: true,
    since: "2026-10-01T00:00:00Z",
    inviteUrl: null,
  };
}

const invited: CompanySuperAdmin = {
  kind: "invited",
  userId: null,
  invitationId: "inv-9",
  fullName: null,
  email: "new.boss@acme.com",
  isActive: false,
  since: "2026-10-10T00:00:00Z",
  inviteUrl: "https://neuvto.com/auth?invite=abc",
};

function rowFor(text: string) {
  return screen.getAllByTestId("super-admin-row").find((r) => r.textContent?.includes(text))!;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SuperAdminsPanel", () => {
  it("does not offer to remove the only Super Admin, even with an invitation pending", async () => {
    api.listSuperAdmins.mockResolvedValue([member("u1", "Alice", "alice@acme.com"), invited]);
    render(<SuperAdminsPanel organizationId={ORG} organizationName="Acme" />);

    const alice = await waitFor(() => rowFor("Alice"));
    expect(within(alice).getByTestId("super-admin-remove")).toBeDisabled();
    // The invitation does not count as a second Super Admin, but it can go.
    expect(within(rowFor("new.boss")).getByTestId("super-admin-remove")).toBeEnabled();
  });

  it("removes the person on the row, only after asking again", async () => {
    const user = userEvent.setup();
    api.listSuperAdmins.mockResolvedValue([
      member("u1", "Alice", "alice@acme.com"),
      member("u2", "Priya", "priya@acme.com"),
    ]);
    api.removeSuperAdmin.mockResolvedValue(undefined);
    render(<SuperAdminsPanel organizationId={ORG} organizationName="Acme" />);

    const priya = await waitFor(() => rowFor("Priya"));
    await user.click(within(priya).getByTestId("super-admin-remove"));
    expect(api.removeSuperAdmin).not.toHaveBeenCalled();

    await user.click(within(rowFor("Priya")).getByTestId("super-admin-confirm-remove"));
    expect(api.removeSuperAdmin).toHaveBeenCalledWith(ORG, "u2");
    expect(api.withdrawSuperAdminInvite).not.toHaveBeenCalled();
  });

  it("withdraws an invitation rather than removing anybody", async () => {
    const user = userEvent.setup();
    api.listSuperAdmins.mockResolvedValue([member("u1", "Alice", "alice@acme.com"), invited]);
    api.withdrawSuperAdminInvite.mockResolvedValue(undefined);
    render(<SuperAdminsPanel organizationId={ORG} organizationName="Acme" />);

    await user.click(
      within(await waitFor(() => rowFor("new.boss"))).getByTestId("super-admin-remove"),
    );
    await user.click(within(rowFor("new.boss")).getByTestId("super-admin-confirm-remove"));
    expect(api.withdrawSuperAdminInvite).toHaveBeenCalledWith("inv-9");
    expect(api.removeSuperAdmin).not.toHaveBeenCalled();
  });

  it("shows a refusal, and drops it when the next attempt starts", async () => {
    const user = userEvent.setup();
    api.listSuperAdmins.mockResolvedValue([member("u1", "Alice", "alice@acme.com")]);
    api.addSuperAdmin
      .mockRejectedValueOnce(
        new AppError(
          "EMAIL_IN_ANOTHER_WORKSPACE",
          "That person already belongs to another company on Neuvto.",
          400,
        ),
      )
      .mockImplementationOnce(() => new Promise(() => {})); // second attempt never settles
    render(<SuperAdminsPanel organizationId={ORG} organizationName="Acme" />);

    await user.type(await screen.findByTestId("super-admin-email"), "bob@vertex.com");
    await user.click(screen.getByTestId("super-admin-add"));
    expect(await screen.findByTestId("super-admin-error")).toHaveTextContent(
      "already belongs to another company",
    );

    await user.clear(screen.getByTestId("super-admin-email"));
    await user.type(screen.getByTestId("super-admin-email"), "priya@acme.com");
    await user.click(screen.getByTestId("super-admin-add"));
    expect(screen.queryByTestId("super-admin-error")).toBeNull();
  });

  it("says a member was promoted, clears the form and shows them in the list", async () => {
    const user = userEvent.setup();
    api.listSuperAdmins
      .mockResolvedValueOnce([member("u1", "Alice", "alice@acme.com")])
      .mockResolvedValueOnce([
        member("u1", "Alice", "alice@acme.com"),
        member("u2", "Priya", "priya@acme.com"),
      ]);
    api.addSuperAdmin.mockResolvedValue("promoted");
    render(<SuperAdminsPanel organizationId={ORG} organizationName="Acme" />);

    const email = await screen.findByTestId("super-admin-email");
    await user.type(email, "priya@acme.com");
    await user.click(screen.getByTestId("super-admin-add"));

    expect(api.addSuperAdmin).toHaveBeenCalledWith(ORG, "priya@acme.com", "");
    expect(await screen.findByTestId("super-admin-notice")).toHaveTextContent(
      "They're a Super Admin now.",
    );
    expect(email).toHaveValue("");
    expect(screen.getAllByTestId("super-admin-row")).toHaveLength(2);
    // Two members now, so Alice can be removed.
    expect(within(rowFor("Alice")).getByTestId("super-admin-remove")).toBeEnabled();
  });

  it("says an invitation was sent, not that they are already a Super Admin", async () => {
    const user = userEvent.setup();
    api.listSuperAdmins.mockResolvedValue([member("u1", "Alice", "alice@acme.com")]);
    api.addSuperAdmin.mockResolvedValue("invited");
    render(<SuperAdminsPanel organizationId={ORG} organizationName="Acme" />);

    await user.type(await screen.findByTestId("super-admin-email"), "new@acme.com");
    await user.click(screen.getByTestId("super-admin-add"));
    expect(await screen.findByTestId("super-admin-notice")).toHaveTextContent(
      "Invited. They become a Super Admin when they accept.",
    );
  });
});

// @vitest-environment happy-dom

/**
 * Sign-in and security (D79) — the page where somebody sets up and removes the
 * devices that can sign them in with a face or fingerprint.
 *
 * Three nothings this page must keep apart:
 *
 *   · "this device can't do it"   — say so, and offer no button that can only fail;
 *   · "you have no devices yet"   — the ordinary state of everybody on day one;
 *   · "we couldn't read your devices" — which must NOT read as the second one.
 *     Somebody told "no devices" when they have three believes a lost laptop
 *     can no longer sign in as them, and stops looking.
 *
 * `@/platform/auth/passkeys` is the device and the server, so it is the seam.
 * Its own refusal wording is pinned in passkeys.test.ts, not here.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

vi.mock("@/platform/auth", () => ({
  getSessionEmail: async () => "ravi.emp@acme.test",
}));

vi.mock("@/platform/auth/passkeys", () => ({
  deviceSupportsPasskeys: vi.fn(),
  listPasskeys: vi.fn(),
  registerThisDevice: vi.fn(),
  removePasskey: vi.fn(),
}));

import { AppError } from "@/platform/errors";
import {
  deviceSupportsPasskeys,
  listPasskeys,
  removePasskey,
  type Passkey,
} from "@/platform/auth/passkeys";
import { Route } from "./security";

const SecurityPage = (Route as unknown as { component: () => React.ReactElement }).component;

const supports = vi.mocked(deviceSupportsPasskeys);
const list = vi.mocked(listPasskeys);
const remove = vi.mocked(removePasskey);

/** Two, so that removing the second cannot be satisfied by removing the first. */
const LAPTOP: Passkey = {
  id: "pk-laptop-0001",
  name: "Work MacBook",
  createdAt: "2026-09-01T09:00:00Z",
  lastUsedAt: "2026-10-10T08:30:00Z",
};
const PHONE: Passkey = {
  id: "pk-phone-0002",
  name: "Pixel 8",
  createdAt: "2026-09-15T09:00:00Z",
  lastUsedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  supports.mockResolvedValue(true);
  list.mockResolvedValue([]);
  remove.mockResolvedValue(undefined);
});

describe("Sign-in and security — a device that cannot do it", () => {
  it("says so, and offers no Set up button", async () => {
    supports.mockResolvedValue(false);
    render(<SecurityPage />);

    expect(await screen.findByTestId("passkey-unsupported")).toHaveTextContent(
      /can't do face or fingerprint sign-in/,
    );
    expect(screen.queryByTestId("add-passkey")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up on this device" })).toBeNull();
  });

  it("offers Set up, and no unsupported note, on a device that can", async () => {
    // The other side of the gate, so the test above cannot pass against a page
    // that simply never renders the button.
    render(<SecurityPage />);

    expect(await screen.findByRole("button", { name: "Set up on this device" })).toBeEnabled();
    expect(screen.queryByTestId("passkey-unsupported")).toBeNull();
  });
});

describe("Sign-in and security — the device list", () => {
  it("says there are no devices yet when there are none", async () => {
    render(<SecurityPage />);

    expect(await screen.findByTestId("no-passkeys")).toHaveTextContent("No devices set up yet.");
    expect(screen.queryAllByTestId("passkey-row")).toHaveLength(0);
  });

  it("lists each device by name, and Remove sends that device's id", async () => {
    list.mockResolvedValue([LAPTOP, PHONE]);
    const user = userEvent.setup();
    render(<SecurityPage />);

    const rows = await screen.findAllByTestId("passkey-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Work MacBook")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Pixel 8")).toBeInTheDocument();
    expect(screen.queryByTestId("no-passkeys")).toBeNull();

    // The second one, so "always the first" cannot pass.
    list.mockResolvedValue([LAPTOP]);
    await user.click(screen.getByRole("button", { name: "Remove Pixel 8" }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(PHONE.id);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Pixel 8 removed. It can no longer sign you in.",
    );
    await waitFor(() => expect(screen.getAllByTestId("passkey-row")).toHaveLength(1));
  });

  it("shows why the list could not be read, rather than an empty list", async () => {
    // The dangerous nothing: "No devices set up yet" about somebody who has a
    // laptop that can still sign in as them.
    const WHY = "Your session has ended. Sign in again to see your devices.";
    list.mockRejectedValue(new AppError("INTERNAL_ERROR", WHY, 500));
    render(<SecurityPage />);

    // Settled: the skeleton has given way to SOMETHING. Then the wrong answer is
    // named first, so the regression fails by quoting it.
    await waitFor(() => expect(document.querySelector(".animate-pulse")).toBeNull());
    expect(screen.queryByText("No devices set up yet.")).toBeNull();
    expect(screen.queryByTestId("no-passkeys")).toBeNull();
    expect(screen.getByText(WHY)).toHaveAttribute("role", "alert");
  });
});

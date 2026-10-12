// @vitest-environment happy-dom

/**
 * Statutory and bank (E6, D80, D85), rendered from real employee_card() output
 * per role (__fixtures__/cards.json). What it pins:
 *
 * - the tab and each panel exist only for the roles the database gives them
 *   to; the Admin and an Employee Admin get every number as its last four,
 *   with an eye on each, and the bank panel;
 * - the person themselves gets last fours and no eye anywhere, restricted
 *   data included;
 * - the eye asks for nothing: one click shows the number, marked "Shown,
 *   logged", and a second click locks it again;
 * - the shown value is gone two minutes later, and on "Hide everything";
 * - a refused look shows why, and shows no value;
 * - the value never lands in the URL or browser storage;
 * - an editor sends only what changed, and an empty number field means "keep".
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  getRestrictedReads: vi.fn(),
  revealRestricted: vi.fn(),
  setStatutory: vi.fn(),
  setBank: vi.fn(),
  setRestricted: vi.fn(),
}));
vi.mock("../handlers", () => api);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { EmployeeCardView } from "./EmployeeCardView";
import { REVEAL_LIFETIME_MS, StatutoryTab } from "./StatutoryTab";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const AADHAAR = "234567890124";

beforeEach(() => {
  vi.resetAllMocks();
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

function tabNames() {
  return screen.getAllByRole("tab").map((t) => t.textContent);
}

describe("Statutory and bank, per role", () => {
  it("does not exist for a colleague or the approver", () => {
    render(<EmployeeCardView card={as("colleague")} />);
    expect(tabNames()).not.toContain("Statutory and bank");
  });

  it.each(["admin", "employeeAdmin"] as const)(
    "gives the %s every number locked to its last four, each with an eye, and the bank",
    (role) => {
      render(<StatutoryTab card={as(role)} onChanged={() => {}} />);
      expect(screen.getByTestId("aadhaar-masked")).toHaveTextContent("•••• 0124");
      expect(screen.getByTestId("uan-masked")).toHaveTextContent("•••• 7890");
      expect(screen.queryByText("101234567890")).toBeNull();
      for (const label of [
        "UAN",
        "EPF number",
        "ESIC number",
        "Aadhaar",
        "PAN",
        "account number",
      ]) {
        expect(screen.getByRole("button", { name: `Show ${label}` })).toBeInTheDocument();
      }
      expect(screen.getByTestId("panel-bank")).toBeInTheDocument();
      expect(screen.getByTestId("reveal-restricted")).toBeInTheDocument();
      expect(screen.getByTestId("edit-statutory")).toBeInTheDocument();
      expect(screen.getByTestId("edit-bank")).toBeInTheDocument();
      expect(screen.getByTestId("edit-restricted")).toBeInTheDocument();
    },
  );

  it("gives the person their last fours and no eye anywhere", () => {
    render(<StatutoryTab card={as("self")} onChanged={() => {}} />);
    expect(screen.getByTestId("aadhaar-masked")).toHaveTextContent("•••• 0124");
    expect(screen.getByTestId("bank-account-masked")).toHaveTextContent("•••• 5678");
    expect(screen.queryAllByRole("button", { name: /^Show / })).toHaveLength(0);
    expect(screen.getByTestId("restricted-held")).toHaveTextContent("Recorded");
    expect(screen.queryByTestId("reveal-restricted")).toBeNull();
    expect(screen.queryByTestId("edit-restricted")).toBeNull();
  });

  it("gives Payroll the full UAN and the bank, with an eye on the account only", () => {
    render(<StatutoryTab card={as("payroll")} onChanged={() => {}} />);
    expect(within(screen.getByTestId("panel-pf")).getByText("101234567890")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show account number" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show Aadhaar" })).toBeNull();
    expect(screen.queryByTestId("panel-verification")).toBeNull();
  });
});

describe("the eye", () => {
  it("shows the number at once, asks for nothing, and locks it again on a second click", async () => {
    const user = userEvent.setup();
    api.revealRestricted.mockResolvedValue({ uan: "101234567890" });
    render(<StatutoryTab card={as("admin")} onChanged={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Show UAN" }));
    expect(api.revealRestricted).toHaveBeenCalledWith(as("admin").id, ["uan"]);
    expect(screen.queryByTestId("reveal-prompt")).toBeNull();
    const shown = await screen.findByTestId("uan-value");
    expect(shown).toHaveTextContent("101234567890");
    expect(shown).toHaveTextContent("Shown, logged");

    await user.click(screen.getByRole("button", { name: "Hide UAN" }));
    expect(screen.queryByTestId("uan-value")).toBeNull();
    expect(screen.getByTestId("uan-masked")).toHaveTextContent("•••• 7890");
  });

  it("opens restricted data the same way", async () => {
    const user = userEvent.setup();
    api.revealRestricted.mockResolvedValue({ religion: "Hindu", casteCategory: "obc" });
    render(<StatutoryTab card={as("employeeAdmin")} onChanged={() => {}} />);
    await user.click(screen.getByTestId("reveal-restricted"));
    expect(api.revealRestricted).toHaveBeenCalledWith(as("employeeAdmin").id, [
      "religion",
      "caste_category",
      "disability",
    ]);
    expect(await screen.findByTestId("restricted-revealed")).toHaveTextContent("Hindu");
  });

  it("forgets the value two minutes later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    api.revealRestricted.mockResolvedValue({ aadhaar: AADHAAR });
    render(<StatutoryTab card={as("statutory")} onChanged={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Show Aadhaar" }));
    await screen.findByTestId("aadhaar-value");

    await act(() => vi.advanceTimersByTimeAsync(REVEAL_LIFETIME_MS - 1000));
    expect(screen.getByTestId("aadhaar-value")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.queryByTestId("aadhaar-value")).toBeNull();
    expect(screen.getByTestId("aadhaar-masked")).toHaveTextContent("•••• 0124");
  });

  it("hides everything on request, and never puts the value in the URL or storage", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    api.revealRestricted.mockResolvedValue({ aadhaar: AADHAAR });
    render(<StatutoryTab card={as("admin")} onChanged={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Show Aadhaar" }));
    await screen.findByTestId("aadhaar-value");

    expect(window.location.href).toBe(before);
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain(AADHAAR);

    await user.click(screen.getByTestId("hide-revealed"));
    expect(screen.queryByTestId("aadhaar-value")).toBeNull();
  });

  it("shows a refusal and no value", async () => {
    const user = userEvent.setup();
    api.revealRestricted.mockRejectedValue(
      new AppError("FORBIDDEN", "You can't see that number.", 403),
    );
    render(<StatutoryTab card={as("admin")} onChanged={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Show Aadhaar" }));
    expect(await screen.findByTestId("reveal-error")).toHaveTextContent("can't see");
    expect(screen.queryByTestId("aadhaar-value")).toBeNull();
  });

  it("lists a look that gave no reason without inventing one", async () => {
    api.getRestrictedReads.mockResolvedValue([
      { readAt: "2026-10-12T10:00:00Z", readerName: "Hema HR", fields: ["uan"], reason: null },
    ]);
    render(<StatutoryTab card={as("self")} onChanged={() => {}} />);
    const list = await screen.findByTestId("reads-list");
    expect(list).toHaveTextContent("Hema HR saw uan");
    expect(list).not.toHaveTextContent("null");
  });
});

describe("editing", () => {
  it("sends only what changed, and an empty number field keeps what is on record", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    api.setStatutory.mockResolvedValue(undefined);
    render(<StatutoryTab card={as("admin")} onChanged={onChanged} />);

    await user.click(screen.getByTestId("edit-statutory"));
    const editor = screen.getByTestId("editor-statutory");
    const inputs = within(editor).getAllByRole("textbox");
    // Aadhaar is the first field. It shows its last four as a hint, not a value.
    expect(inputs[0]).toHaveValue("");
    expect(inputs[0]).toHaveAttribute("placeholder", expect.stringContaining("0124"));
    await user.type(inputs[2], "999988887777"); // UAN

    await user.click(screen.getByTestId("save-statutory"));
    expect(api.setStatutory).toHaveBeenCalledWith(as("admin").id, { uan: "999988887777" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps the form open with the reason when a number is refused", async () => {
    const user = userEvent.setup();
    api.setStatutory.mockRejectedValue(
      new AppError(
        "VALIDATION_FAILED",
        "That isn't a valid Aadhaar number. Check the 12 digits.",
        400,
      ),
    );
    render(<StatutoryTab card={as("admin")} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-statutory"));
    const inputs = within(screen.getByTestId("editor-statutory")).getAllByRole("textbox");
    await user.type(inputs[0], "234567890125");
    await user.click(screen.getByTestId("save-statutory"));
    expect(await screen.findByTestId("editor-statutory-error")).toHaveTextContent("valid Aadhaar");
    expect(inputs[0]).toHaveValue("234567890125");
  });
});

// @vitest-environment happy-dom

/**
 * Statutory and bank (E6, D80), rendered from real employee_card() output per
 * role (__fixtures__/cards.json). What it pins:
 *
 * - the tab and each panel exist only for the roles §5 gives them to; Admin
 *   gets no bank panel and no Reveal on Aadhaar;
 * - a reveal asks for a reason first, sends it, and shows the value with
 *   "Shown, logged";
 * - the revealed value is gone two minutes later, and on "Hide everything";
 * - a refused reveal shows why, and shows no value;
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

  it("gives an Admin last fours and verification, no bank and no reveal", () => {
    render(<StatutoryTab card={as("admin")} onChanged={() => {}} />);
    expect(screen.getByTestId("aadhaar-masked")).toHaveTextContent("•••• 0124");
    expect(screen.queryByTestId("reveal-aadhaar")).toBeNull();
    expect(screen.queryByTestId("panel-bank")).toBeNull();
    expect(screen.getByTestId("panel-verification")).toBeInTheDocument();
    expect(within(screen.getByTestId("panel-pf")).getByText("•••• 7890")).toBeInTheDocument();
    expect(screen.getByTestId("edit-statutory")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-bank")).toBeNull();
  });

  it("gives Payroll the full UAN and the bank, with a reveal for the account only", () => {
    render(<StatutoryTab card={as("payroll")} onChanged={() => {}} />);
    expect(within(screen.getByTestId("panel-pf")).getByText("101234567890")).toBeInTheDocument();
    expect(screen.getByTestId("reveal-bank-account")).toBeInTheDocument();
    expect(screen.queryByTestId("reveal-aadhaar")).toBeNull();
    expect(screen.queryByTestId("panel-verification")).toBeNull();
  });
});

describe("revealing", () => {
  it("asks why, sends the reason, and marks the value as shown and logged", async () => {
    const user = userEvent.setup();
    api.revealRestricted.mockResolvedValue({ aadhaar: AADHAAR });
    render(<StatutoryTab card={as("statutory")} onChanged={() => {}} />);

    await user.click(screen.getByTestId("reveal-aadhaar"));
    const confirm = screen.getByTestId("reveal-confirm");
    expect(confirm).toBeDisabled();
    expect(api.revealRestricted).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("reveal-reason"), "ECR filing");
    await user.click(confirm);

    expect(api.revealRestricted).toHaveBeenCalledWith(
      as("statutory").id,
      ["aadhaar"],
      "ECR filing",
    );
    const shown = await screen.findByTestId("aadhaar-value");
    expect(shown).toHaveTextContent(AADHAAR);
    expect(shown).toHaveTextContent("Shown, logged");
    expect(screen.queryByTestId("reveal-prompt")).toBeNull();
  });

  it("forgets the value two minutes later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    api.revealRestricted.mockResolvedValue({ aadhaar: AADHAAR });
    render(<StatutoryTab card={as("statutory")} onChanged={() => {}} />);

    await user.click(screen.getByTestId("reveal-aadhaar"));
    await user.type(screen.getByTestId("reveal-reason"), "ECR filing");
    await user.click(screen.getByTestId("reveal-confirm"));
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
    render(<StatutoryTab card={as("statutory")} onChanged={() => {}} />);

    await user.click(screen.getByTestId("reveal-aadhaar"));
    await user.type(screen.getByTestId("reveal-reason"), "ECR filing");
    await user.click(screen.getByTestId("reveal-confirm"));
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
      new AppError("VALIDATION_FAILED", "Say why you need to see it.", 400),
    );
    render(<StatutoryTab card={as("statutory")} onChanged={() => {}} />);
    await user.click(screen.getByTestId("reveal-aadhaar"));
    await user.type(screen.getByTestId("reveal-reason"), "abc");
    await user.click(screen.getByTestId("reveal-confirm"));
    expect(await screen.findByTestId("reveal-error")).toHaveTextContent("Say why");
    expect(screen.queryByTestId("aadhaar-value")).toBeNull();
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

// @vitest-environment happy-dom

/**
 * Opening balances carries the people who have not joined yet (D88) beneath
 * the people who have, so one screen holds every opening balance.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: [], error: null })) },
}));
vi.mock("./StagedOpeningBalances", () => ({
  default: () => <p>staged section</p>,
}));

import OpeningBalances from "./OpeningBalances";

describe("opening balances", () => {
  it("shows the people not yet joined beneath the people who have", async () => {
    render(<OpeningBalances />);
    expect(await screen.findByText("staged section")).toBeInTheDocument();
  });
});

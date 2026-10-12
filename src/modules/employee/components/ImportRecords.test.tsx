// @vitest-environment happy-dom

/**
 * Bulk import (E8). What it pins:
 *
 * - choosing a file runs the dry run, and nothing is committed until a button
 *   says how many rows it will import;
 * - with problems, only the clean rows are offered, with the lines to fix;
 *   with none, everything is;
 * - a file without full_name is refused before anything is sent.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ checkImport: vi.fn(), commitImport: vi.fn() }));
vi.mock("../handlers", () => api);
vi.mock("@/platform/modules", () => ({
  ModuleLink: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import ImportRecords from "./ImportRecords";

const file = (text: string) => new File([text], "staff.csv", { type: "text/csv" });

beforeEach(() => vi.resetAllMocks());

describe("ImportRecords", () => {
  it("dry-runs on choosing, and offers only the clean rows when some need attention", async () => {
    const user = userEvent.setup();
    api.checkImport.mockResolvedValue([
      { index: 1, problems: {} },
      { index: 2, problems: { designation: "Not in the designation list" } },
    ]);
    api.commitImport.mockResolvedValue({ created: 1, skipped: 1 });
    render(<ImportRecords />);
    await user.upload(
      screen.getByTestId("import-file"),
      file("full_name,designation,aadhaar\nAsha,Guard,234567890124\nRavi,Astronaut,\n"),
    );

    expect(api.checkImport).toHaveBeenCalledWith([
      { full_name: "Asha", designation: "Guard" },
      { full_name: "Ravi", designation: "Astronaut" },
    ]);
    expect(api.commitImport).not.toHaveBeenCalled();
    expect(await screen.findByTestId("import-problems")).toHaveTextContent(
      "Line 3 (Ravi): designation: Not in the designation list",
    );
    expect(screen.queryByTestId("import-all")).toBeNull();
    const rows = screen.getAllByTestId("import-column-row").map((r) => r.textContent);
    expect(rows.find((t) => t?.startsWith("aadhaar"))).toContain("Not imported");
    expect(rows.find((t) => t?.startsWith("designation"))).toContain("1 row needs attention");

    await user.click(screen.getByTestId("import-clean"));
    expect(api.commitImport).toHaveBeenCalledWith(expect.any(Array), true);
    expect(await screen.findByTestId("import-done")).toHaveTextContent(
      "1 record imported as drafts, 1 skipped",
    );
  });

  it("offers everything when nothing needs attention", async () => {
    const user = userEvent.setup();
    api.checkImport.mockResolvedValue([{ index: 1, problems: {} }]);
    api.commitImport.mockResolvedValue({ created: 1, skipped: 0 });
    render(<ImportRecords />);
    await user.upload(screen.getByTestId("import-file"), file("full_name\nAsha\n"));
    await user.click(await screen.findByTestId("import-all"));
    expect(api.commitImport).toHaveBeenCalledWith([{ full_name: "Asha" }], false);
  });

  it("refuses a file without full_name before sending anything", async () => {
    const user = userEvent.setup();
    render(<ImportRecords />);
    await user.upload(screen.getByTestId("import-file"), file("name,email\nAsha,a@b.test\n"));
    expect(await screen.findByTestId("import-error")).toHaveTextContent("needs a full_name column");
    expect(api.checkImport).not.toHaveBeenCalled();
  });
});

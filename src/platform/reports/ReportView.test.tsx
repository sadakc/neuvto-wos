// @vitest-environment happy-dom

/**
 * The report frame's three files (D94). What it pins: Excel and PDF, like the
 * CSV, write exactly what is on screen (the search included), named for the
 * report and the organisation's day, the PDF titled and dated; and none of
 * them is offered while the day is unknown.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ downloadXlsx: vi.fn(), downloadPdf: vi.fn(), downloadCsv: vi.fn() }));
vi.mock("./export", () => ({ downloadXlsx: h.downloadXlsx, downloadPdf: h.downloadPdf }));
vi.mock("./csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./csv")>()),
  downloadCsv: h.downloadCsv,
}));

import { ReportView } from "./ReportView";

type Row = { name: string; days: number };
const COLUMNS = [
  { header: "Employee", value: (r: Row) => r.name },
  { header: "Days", value: (r: Row) => r.days, numeric: true },
];
const ROWS: Row[] = [
  { name: "Ravi", days: 3 },
  { name: "Priya", days: 5 },
];

const view = (today: string | null = "2026-10-12") =>
  render(
    <ReportView
      slug="leave-liability"
      title="Leave liability"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.name}
      state="ready"
      empty="Nothing."
      today={today}
    />,
  );

beforeEach(() => vi.resetAllMocks());

describe("the report's files", () => {
  it("writes Excel and PDF of exactly what is on screen, named and dated", async () => {
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText("Find somebody"), "priya");
    await user.click(screen.getByRole("button", { name: "Excel" }));
    expect(h.downloadXlsx).toHaveBeenCalledWith(
      "leave-liability-2026-10-12.xlsx",
      "Leave liability",
      ["Employee", "Days"],
      [["Priya", 5]],
    );
    await user.click(screen.getByRole("button", { name: "PDF" }));
    expect(h.downloadPdf).toHaveBeenCalledWith(
      "leave-liability-2026-10-12.pdf",
      "Leave liability",
      "As of 12 Oct 2026 · 1 row, searched for “priya”",
      ["Employee", "Days"],
      [["Priya", 5]],
    );
  });

  it("offers none of the files while the organisation's day is unknown", () => {
    view(null);
    for (const name of ["Export CSV", "Excel", "PDF"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});

// @vitest-environment happy-dom

/**
 * Importing the master template (D86). What it pins:
 *
 * - the template is built with the company's own designations, departments
 *   and units, so its drop-downs offer exactly those;
 * - choosing a file is a dry run: the database is asked and nothing is kept;
 * - each problem is named by tab, the row in Excel, the person and the column,
 *   in words;
 * - a clean file imports whole; a file with problems imports only its clean
 *   people, and only when asked;
 * - what the browser could not read is shown, and nothing is sent.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  importMaster: vi.fn(),
  listUnits: vi.fn(),
  listAllDesignations: vi.fn(),
  listDepartments: vi.fn(),
  buildTemplate: vi.fn(),
  readWorkbook: vi.fn(),
}));

vi.mock("../handlers", () => ({
  importMaster: h.importMaster,
  listUnits: h.listUnits,
  listAllDesignations: h.listAllDesignations,
}));
vi.mock("@/platform/organization", () => ({ listDepartments: h.listDepartments }));
vi.mock("../masterWorkbook", () => ({
  buildTemplate: h.buildTemplate,
  readWorkbook: h.readWorkbook,
}));
vi.mock("@/platform/modules", () => ({
  ModuleLink: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import ImportRecords from "./ImportRecords";
// Real employee_import_master() answers to the two files below, captured by
// neuvto-harness/tools/import_master_fixtures.sql. A hand-written answer once
// named a column the database never sends.
import answers from "./__fixtures__/import.json";

const PEOPLE_HEAD = ["Employee code", "Full name", "Aadhaar", "Date of joining"];
const FAMILY_HEAD = ["Employee code", "Relation", "Name"];
const CLEAN_FILE = {
  People: [
    PEOPLE_HEAD,
    ["E-1", "Mallappa", "234567890124", "2026-11-02"],
    ["E-2", "Lakshmi", "345678901238", null],
  ],
  Family: [FAMILY_HEAD, ["E-1", "Son", "Arun"]],
};
/** Lakshmi's Aadhaar is short, and Kavya's row names nobody on People. */
const FILE_WITH_PROBLEMS = {
  People: [
    PEOPLE_HEAD,
    ["E-1", "Mallappa", "234567890124", "2026-11-02"],
    ["E-2", "Lakshmi", "123", null],
  ],
  Family: [FAMILY_HEAD, ["E-1", "Son", "Arun"], ["E-9", "Daughter", "Kavya"]],
};

beforeEach(() => {
  vi.resetAllMocks();
  h.listUnits.mockResolvedValue([
    { id: "u1", name: "HQ", status: "active" },
    { id: "u2", name: "Old Depot", status: "retired" },
  ]);
  h.listAllDesignations.mockResolvedValue([
    { id: "d1", name: "Security Guard", status: "active" },
    { id: "d2", name: "Watchman", status: "retired" },
  ]);
  h.listDepartments.mockResolvedValue([{ id: "x", name: "Operations" }]);
  h.buildTemplate.mockResolvedValue(new ArrayBuffer(8));
  h.readWorkbook.mockResolvedValue(CLEAN_FILE);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

const upload = async () => {
  const user = userEvent.setup();
  render(<ImportRecords />);
  const file = new File([new Uint8Array([1, 2, 3])], "master.xlsx");
  await user.upload(screen.getByTestId("import-file"), file);
  return user;
};

describe("the template", () => {
  it("is built with the company's active designations, departments and units", async () => {
    const user = userEvent.setup();
    render(<ImportRecords />);
    await user.click(screen.getByTestId("import-template"));
    expect(h.buildTemplate).toHaveBeenCalledWith({
      designations: ["Security Guard"],
      departments: ["Operations"],
      units: ["HQ"],
    });
  });
});

describe("importing", () => {
  it("dry-runs first, then imports a clean file whole", async () => {
    h.importMaster
      .mockResolvedValueOnce(answers.clean.check)
      .mockResolvedValueOnce(answers.clean.import);
    const user = await upload();

    // The file the database answered is the file the screen sends.
    expect(h.importMaster).toHaveBeenNthCalledWith(1, answers.clean.workbook, false, false);
    expect(await screen.findByTestId("import-summary")).toHaveTextContent(
      "2 of 2 people are ready",
    );
    await user.click(screen.getByTestId("import-all"));
    expect(h.importMaster).toHaveBeenNthCalledWith(2, expect.any(Object), true, false);
    expect(await screen.findByTestId("import-done")).toHaveTextContent(
      "2 people imported as drafts",
    );
  });

  it("names each problem by tab, Excel row, person and column, and imports only the clean on request", async () => {
    h.readWorkbook.mockResolvedValue(FILE_WITH_PROBLEMS);
    h.importMaster
      .mockResolvedValueOnce(answers.problems.check)
      .mockResolvedValueOnce(answers.problems.importClean);
    const user = await upload();
    expect(h.importMaster).toHaveBeenNthCalledWith(1, answers.problems.workbook, false, false);

    const list = await screen.findByTestId("import-problems");
    // The card's writer refuses the number without naming the column, so the
    // line names the part of the card it belongs to.
    expect(list).toHaveTextContent(
      "People, row 3 (E-2): Statutory numbers: That isn't a valid Aadhaar number",
    );
    expect(list).toHaveTextContent("Family, row 3: Employee code: Not on the People tab");
    expect(screen.queryByTestId("import-all")).toBeNull();
    await user.click(screen.getByTestId("import-clean"));
    expect(h.importMaster).toHaveBeenNthCalledWith(2, expect.any(Object), true, true);
    expect(await screen.findByTestId("import-done")).toHaveTextContent(
      "1 person imported as drafts, 1 skipped",
    );
  });

  it("shows what the file itself could not say, and sends nothing", async () => {
    h.readWorkbook.mockResolvedValue({
      People: [PEOPLE_HEAD, ["E-1", "Mallappa", null, "31/02/2026"]],
    });
    await upload();
    expect(await screen.findByTestId("import-problems")).toHaveTextContent(
      "People, row 2: Date of joining: Not a date. Write it as DD/MM/YYYY, like 05/08/1990.",
    );
    // D106: the page says what a date looks like before anything is uploaded.
    expect(screen.getByTestId("import-date-format")).toHaveTextContent(
      "DD/MM/YYYY, like 05/08/1990",
    );
    expect(h.importMaster).not.toHaveBeenCalled();
  });
});

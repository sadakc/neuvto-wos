/**
 * The master template (D86), written and read back through a real Excel file.
 *
 * - its columns are exactly the keys the database accepts (read from the
 *   migration, so the two cannot drift);
 * - the downloaded template reads back clean and empty;
 * - a filled workbook becomes the database's keys: dates from date cells,
 *   choices from their labels, any number of children as rows;
 * - what Excel has already broken (a long number in a number cell) is
 *   refused with a reason, not stored wrong;
 * - a reordered sheet still reads.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { MASTER_TEMPLATE, forDatabase, readGrids, toIsoDate } from "./masterTemplate";
import { buildTemplate, readWorkbook } from "./masterWorkbook";

const lists = { designations: ["Security Guard"], departments: ["Operations"], units: ["HQ"] };

function databaseKeys(tab: string): string[] {
  const sql = readFileSync("supabase/migrations/20261019100000_the_master_template.sql", "utf8");
  const m = sql.match(new RegExp(`when '${tab}' then array\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`no keys for ${tab} in the migration`);
  return [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]);
}

async function fill(build: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

const headersOf = (tabKey: string) =>
  MASTER_TEMPLATE.find((t) => t.key === tabKey)!.columns.map((c) => c.header);

describe("the template's columns", () => {
  it.each(MASTER_TEMPLATE.map((t) => [t.key]))("%s has exactly the database's keys", (key) => {
    const tab = MASTER_TEMPLATE.find((t) => t.key === key)!;
    expect(tab.columns.map((c) => c.key).sort()).toEqual(databaseKeys(key).sort());
  });

  it("has no numbered family slots", () => {
    const all = MASTER_TEMPLATE.flatMap((t) => t.columns.map((c) => c.header));
    expect(all.filter((h) => /\b(son|daughter)\s*\d/i.test(h))).toEqual([]);
  });
});

describe("the downloaded template", () => {
  it("reads back with every tab, no rows and no problems", async () => {
    const grids = await readWorkbook(await buildTemplate(lists));
    expect(Object.keys(grids)).toEqual(
      expect.arrayContaining([
        "Instructions",
        "People",
        "Family",
        "Nominees",
        "Previous employment",
      ]),
    );
    const { workbook, problems } = readGrids(grids);
    expect(problems).toEqual([]);
    expect(workbook.people).toEqual([]);
  });

  it("formats Aadhaar, the account and every other text column as Text, and offers the company's lists", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplate(lists));
    const people = wb.getWorksheet("People")!;
    const col = (h: string) => headersOf("people").indexOf(h) + 1;
    for (const h of ["Aadhaar", "Bank account number", "Mobile", "Present pincode"]) {
      expect(people.getCell(2, col(h)).numFmt, h).toBe("@");
    }
    // D106: a date column reads as the card does, day first, and its heading says so.
    expect(people.getCell(2, col("Date of joining")).numFmt).toBe("dd/mm/yyyy");
    expect(String(people.getCell(1, col("Date of joining")).note)).toContain("DD/MM/YYYY");
    const v = people.getCell(2, col("Designation")).dataValidation;
    expect(v?.type).toBe("list");
    expect(wb.getWorksheet("Lists")!.getCell(1, 1).value).toBe("Security Guard");
  });
});

describe("a filled workbook", () => {
  it("becomes the database's keys, with any number of children", async () => {
    const data = await fill((wb) => {
      const people = wb.addWorksheet("People");
      people.addRow([
        "Employee code *",
        "Full name *",
        "Date of birth",
        "Marital status",
        "Aadhaar",
        "Permanent address same as present",
        "Height (cm)",
      ]);
      people.addRow([
        "E-1",
        "Mallappa",
        new Date(Date.UTC(1990, 5, 12)),
        "married",
        "234567890124",
        "Yes",
        170,
      ]);
      people.addRow([]);
      people.addRow(["E-2", "Lakshmi", 33036, "-", null, null, null]);
      const family = wb.addWorksheet("Family");
      family.addRow(["Employee code", "Relation", "Name", "Date of birth"]);
      for (const [rel, name] of [
        ["Son", "A"],
        ["Son", "B"],
        ["Son", "C"],
        ["Daughter", "D"],
        ["Daughter", "E"],
      ]) {
        family.addRow(["E-1", rel, name, "2015-01-01"]);
      }
    });
    const { workbook, problems } = readGrids(await readWorkbook(data));
    expect(problems).toEqual([]);
    expect(forDatabase(workbook).people).toEqual([
      {
        employeeCode: "E-1",
        fullName: "Mallappa",
        dateOfBirth: "1990-06-12",
        maritalStatus: "married",
        aadhaar: "234567890124",
        permanentSameAsPresent: "true",
        heightCm: "170",
      },
      { employeeCode: "E-2", fullName: "Lakshmi", dateOfBirth: "1990-06-12" },
    ]);
    expect(workbook.family).toHaveLength(5);
    expect(forDatabase(workbook).family.filter((f) => f.relation === "son")).toHaveLength(3);
  });

  it("refuses a long number Excel has already rounded, an unknown choice and a non-date", async () => {
    const data = await fill((wb) => {
      const people = wb.addWorksheet("People");
      people.addRow([
        "Employee code",
        "Full name",
        "Bank account number",
        "Sex",
        "Date of joining",
      ]);
      people.addRow(["E-1", "X", 123456789012345680, "Martian", "31/02/2026"]);
    });
    const { workbook, problems } = readGrids(await readWorkbook(data));
    expect(problems.map((p) => `${p.row}:${p.column}`).sort()).toEqual(
      ["2:Bank account number", "2:Date of joining", "2:Sex"].sort(),
    );
    expect(workbook.people[0].account).toBeUndefined();
  });

  it("reads columns in any order, and says when People is missing", async () => {
    const shuffled = [...headersOf("previous")].reverse();
    const data = await fill((wb) => {
      wb.addWorksheet("People").addRow(["Full name", "Employee code"]);
      const ws = wb.addWorksheet("previous employment");
      ws.addRow(shuffled);
      ws.addRow(
        shuffled.map((h) => (h === "Employee code" ? "E-1" : h === "Organisation" ? "SIS" : null)),
      );
    });
    expect(readGrids(await readWorkbook(data)).workbook.previous[0]).toMatchObject({
      employeeCode: "E-1",
      organisationName: "SIS",
    });
    expect(readGrids({}).problems[0].message).toBe("This tab is missing.");
  });

  it("turns an Excel serial number into a date, and nothing else", () => {
    expect(toIsoDate(33036)).toBe("1990-06-12");
    expect(toIsoDate("1990-06-12")).toBe("1990-06-12");
    // D106: typed day first, the way the card shows a date.
    expect(toIsoDate("12/06/1990")).toBe("1990-06-12");
    expect(toIsoDate("12-06-1990")).toBe("1990-06-12");
    expect(toIsoDate("5.8.1990")).toBe("1990-08-05");
    // A day that does not exist, a month that does not, and half a date are not dates.
    expect(toIsoDate("31/02/1990")).toBeNull();
    expect(toIsoDate("12/13/1990")).toBeNull();
    expect(toIsoDate("12/06")).toBeNull();
  });
});

describe("states and dates in the template (D106)", () => {
  it("offers every state as a list, reads one in any case, and refuses one that is not a state", async () => {
    const people = MASTER_TEMPLATE.find((t) => t.key === "people")!;
    for (const h of ["Native state", "Present state", "Permanent state"]) {
      const col = people.columns.find((c) => c.header === h)!;
      expect(col.kind, h).toBe("choice");
      expect(col.options?.[0], h).toEqual(["Karnataka", "Karnataka"]);
    }
    const { workbook, problems } = readGrids({
      People: [
        ["Employee code", "Full name", "Native state", "Present state"],
        ["E-1", "Mallappa", "karnataka", "Bijapur"],
      ],
    });
    expect(workbook.people[0].nativeState).toBe("Karnataka");
    expect(problems.map((p) => p.column)).toEqual(["Present state"]);
  });

  it("says what a date looks like in the Instructions tab, for every date column", async () => {
    const data = await buildTemplate(lists);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    const help = wb.getWorksheet("Instructions")!;
    const lines: string[] = [];
    help.eachRow((r) =>
      lines.push(r.values ? String((r.values as unknown[]).slice(1).join(" | ")) : ""),
    );
    expect(lines[1]).toContain("Dates as DD/MM/YYYY, like 05/08/1990");
    expect(lines.find((l) => l.startsWith("People | Date of birth"))).toContain(
      "A date, as DD/MM/YYYY, like 05/08/1990.",
    );
  });
});

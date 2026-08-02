/**
 * The writer, tested against the READER.
 *
 * Every case here is one that step 13's parser tests already proved matters in
 * the other direction. Asserting the writer's output against a hand-written
 * string would only prove it agrees with whoever wrote the expectation; parsing
 * it back with the importer proves the two halves of this product agree with
 * each other, which is the property a customer actually depends on when they
 * export staff, edit a column, and import it again.
 */

import { describe, expect, it } from "vitest";
import { toCsv, reportFilename } from "./csv";
import { parseImportFile } from "@/platform/auth/import";

describe("toCsv", () => {
  it("leaves ordinary values unquoted", () => {
    // Quoting everything is also valid CSV, and is why exports look broken to
    // the person who opens them.
    expect(toCsv(["a", "b"], [["one", "two"]])).toBe("a,b\r\none,two");
  });

  it("quotes a value containing a comma", () => {
    expect(toCsv(["name"], [["Nayar, Reena"]])).toBe('name\r\n"Nayar, Reena"');
  });

  it("doubles a quote inside a quoted value", () => {
    expect(toCsv(["name"], [['Ann "Annie" Shah']])).toBe('name\r\n"Ann ""Annie"" Shah"');
  });

  it("writes null and undefined as empty rather than the word", () => {
    // A department nobody has set must not export as the string "null", which
    // then imports as a department called null.
    expect(toCsv(["a", "b", "c"], [["x", null, undefined]])).toBe("a,b,c\r\nx,,");
  });

  it("quotes a value with leading or trailing space", () => {
    // Otherwise the space survives the write and is trimmed somewhere else.
    expect(toCsv(["name"], [[" Ravi "]])).toBe('name\r\n" Ravi "');
  });

  it("quotes a value containing a newline", () => {
    const out = toCsv(["reason"], [["Family\nfunction"]]);
    expect(out).toBe('reason\r\n"Family\nfunction"');
  });

  it("writes numbers without quoting them", () => {
    expect(toCsv(["days"], [[2.5]])).toBe("days\r\n2.5");
  });
});

describe("round trip through the importer's own parser", () => {
  // The property that matters: export, edit nothing, import — and get back what
  // you exported. Both halves are exercised, so a change to either that breaks
  // the pair fails here.
  it("survives commas, quotes, and everything step 13 found", () => {
    const csv = toCsv(
      ["email", "full_name", "joined_date"],
      [
        ["ravi@acme.test", "Nayar, Reena", "2021-06-15"],
        ["a@acme.test", 'Ann "Annie" Shah', "2024-04-01"],
      ],
    );

    const { rows, missingColumns } = parseImportFile(csv);

    expect(missingColumns).toEqual([]);
    expect(rows.map((r) => r.fullName)).toEqual(["Nayar, Reena", 'Ann "Annie" Shah']);
    expect(rows.map((r) => r.joinedDate)).toEqual(["2021-06-15", "2024-04-01"]);
  });

  it("does not round-trip surrounding whitespace, deliberately", () => {
    // Found by asserting a full round trip and watching it fail. The writer
    // quotes " Padded Name " correctly — that is asserted above — and the
    // IMPORTER trims it, matching `nullif(btrim(_full_name), '')` in
    // invitation_create.
    //
    // That is normalisation, not loss: a name carrying stray spaces out of
    // somebody's spreadsheet should not create a person whose name begins with
    // one. Written down because "export then import returns exactly what you
    // exported" is the obvious assumption, it is nearly true, and this is the
    // one place it is not.
    const csv = toCsv(
      ["email", "full_name", "joined_date"],
      [["b@acme.test", " Padded ", "2023-01-01"]],
    );
    expect(csv).toContain('" Padded "');
    expect(parseImportFile(csv).rows[0].fullName).toBe("Padded");
  });

  it("keeps every column aligned when an earlier one contains a comma", () => {
    // The failure this prevents is not a mangled name — it is every later
    // column shifting by one, so a start date lands in the manager field and
    // nobody notices until entitlements are wrong.
    const csv = toCsv(
      ["email", "full_name", "joined_date", "manager_email"],
      [["x@acme.test", "Patel, Priya", "2024-04-01", "mark@acme.test"]],
    );
    const { rows } = parseImportFile(csv);
    expect(rows[0]).toMatchObject({
      email: "x@acme.test",
      fullName: "Patel, Priya",
      joinedDate: "2024-04-01",
      managerEmail: "mark@acme.test",
    });
  });
});

describe("reportFilename", () => {
  it("names the report and the day it was taken", () => {
    // Two exports a month apart are otherwise indistinguishable in a folder.
    expect(reportFilename("leave-balances", "2026-08-02")).toBe("leave-balances-2026-08-02.csv");
  });
});

/**
 * Every column of the master sheet has a home (criterion 8), checked against
 * the sheet's real headers rather than a count.
 *
 * The headers are in masterSheet.ts.
 */

import { describe, expect, it } from "vitest";
import { FIELD_CATALOGUE } from "./fieldCatalogue";
import { MASTER_SHEET_HEADERS, normaliseHeader as norm } from "./masterSheet";

const fieldFor = (header: string) =>
  FIELD_CATALOGUE.filter((f) => f.sheet !== "new" && f.sheet.some((s) => norm(s) === norm(header)));

describe("the master sheet", () => {
  it("has 62 named columns, two of them repeats", () => {
    expect(MASTER_SHEET_HEADERS).toHaveLength(62);
    expect(new Set(MASTER_SHEET_HEADERS.map(norm)).size).toBe(60);
  });

  it.each(MASTER_SHEET_HEADERS.map((h) => [h]))("%j has exactly one field in Neuvto", (header) => {
    expect(fieldFor(header).map((f) => f.field)).toHaveLength(1);
  });

  it("keeps a repeated column once", () => {
    const names = FIELD_CATALOGUE.flatMap((f) => (f.sheet === "new" ? [] : f.sheet.map(norm)));
    expect(names.filter((n) => n === "FATHERNAME")).toHaveLength(1);
    expect(names.filter((n) => n === "HUSBANDNAME")).toHaveLength(1);
  });

  it("names no column the sheet does not have", () => {
    const sheet = new Set(MASTER_SHEET_HEADERS.map(norm));
    const strays = FIELD_CATALOGUE.flatMap((f) =>
      f.sheet === "new" ? [] : f.sheet.filter((s) => !sheet.has(norm(s))),
    );
    expect(strays).toEqual([]);
  });
});

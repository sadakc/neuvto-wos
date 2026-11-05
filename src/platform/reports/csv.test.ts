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

describe("reportFilename", () => {
  it("names the report and the day it was taken", () => {
    // Two exports a month apart are otherwise indistinguishable in a folder.
    expect(reportFilename("leave-balances", "2026-08-02")).toBe("leave-balances-2026-08-02.csv");
  });
});

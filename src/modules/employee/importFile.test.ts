import { describe, expect, it } from "vitest";
import { readFile } from "./importFile";

describe("reading an employee-records file", () => {
  it("keeps the columns we import, names them the database's way, and drops the rest", () => {
    const p = readFile(
      "staff.csv",
      'Full Name,Email,Aadhaar,Favourite Colour,deployed-unit\n"Rao, Nisha",nisha@acme.test,234567890124,blue,  Tata AIG  \n',
    );
    expect(p.headers.map((h) => [h.column, h.fate])).toEqual([
      ["full_name", "imported"],
      ["email", "imported"],
      ["aadhaar", "never"],
      ["favourite_colour", "unknown"],
      ["deployed_unit", "imported"],
    ]);
    expect(p.rows).toEqual([
      { full_name: "Rao, Nisha", email: "nisha@acme.test", deployed_unit: "Tata AIG" },
    ]);
    // The Aadhaar number never leaves the browser.
    expect(JSON.stringify(p.rows)).not.toContain("234567890124");
  });

  it("leaves an empty cell out rather than sending an empty string", () => {
    const p = readFile("x.csv", "full_name,email,mobile\nAsha,,\n");
    expect(p.rows).toEqual([{ full_name: "Asha" }]);
  });
});

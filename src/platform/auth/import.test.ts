/**
 * The parser, on its own.
 *
 * A customer's file is not a tidy fixture. It comes out of Excel with quoted
 * names containing commas, a UTF-8 BOM, CRLF line endings and a trailing blank
 * line — and every one of those turns into a wrong person or a silent skip if
 * the parser is a `split(",")`.
 */

import { describe, expect, it } from "vitest";
import { parseImportFile, REQUIRED_COLUMNS } from "./import";

const header = "email,full_name,joined_date,manager_email,department,role";

describe("parseImportFile", () => {
  it("reads the documented columns", () => {
    const { rows } = parseImportFile(
      `${header}\nravi@acme.test,Ravi Kumar,2024-04-01,mark@acme.test,Operations,employee`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "ravi@acme.test",
      fullName: "Ravi Kumar",
      joinedDate: "2024-04-01",
      managerEmail: "mark@acme.test",
      department: "Operations",
      role: "employee",
    });
  });

  it("keeps a comma inside a quoted name", () => {
    // The failure this prevents: "Patel, Priya" becoming two columns, shifting
    // every later field along by one, so the start date lands in the manager
    // column and nobody notices until entitlements are wrong.
    const { rows } = parseImportFile(
      `${header}\npriya@acme.test,"Patel, Priya",2024-04-01,,Operations,`,
    );
    expect(rows[0].fullName).toBe("Patel, Priya");
    expect(rows[0].joinedDate).toBe("2024-04-01");
  });

  it("handles doubled quotes inside a quoted field", () => {
    const { rows } = parseImportFile(`${header}\na@acme.test,"Ann ""Annie"" Shah",2024-04-01,,,`);
    expect(rows[0].fullName).toBe('Ann "Annie" Shah');
  });

  it("survives CRLF and a trailing blank line", () => {
    const { rows } = parseImportFile(
      `${header}\r\na@acme.test,A,2024-04-01,,,\r\nb@acme.test,B,2024-04-02,,,\r\n\r\n`,
    );
    expect(rows.map((r) => r.email)).toEqual(["a@acme.test", "b@acme.test"]);
  });

  it("numbers rows the way the spreadsheet does", () => {
    // The person fixing the file is looking at row numbers in Excel, where the
    // header is row 1. An off-by-one here sends them to the wrong line.
    const { rows } = parseImportFile(`${header}\na@acme.test,A,2024-04-01,,,`);
    expect(rows[0].line).toBe(2);
  });

  it("is not case-sensitive about headers or addresses", () => {
    const { rows } = parseImportFile("Email,Full Name,Joined Date\nRAVI@ACME.TEST,Ravi,2024-04-01");
    expect(rows[0].email).toBe("ravi@acme.test");
    expect(rows[0].fullName).toBe("Ravi");
  });

  it("names the columns a file is missing rather than importing nothing quietly", () => {
    const { rows, missingColumns } = parseImportFile("email\na@acme.test");
    expect(rows).toEqual([]);
    expect(missingColumns).toEqual(["full_name", "joined_date"]);
  });

  it("falls back to employee for a role it does not recognise", () => {
    // Deliberately not an error: "Staff" in somebody's spreadsheet should not
    // stop them joining, and an administrator can raise the role afterwards.
    // Quietly granting something higher would be the dangerous direction.
    const { rows } = parseImportFile(`${header}\na@acme.test,A,2024-04-01,,,Wizard`);
    expect(rows[0].role).toBe("employee");
  });

  it("reads a role it does recognise", () => {
    const { rows } = parseImportFile(`${header}\na@acme.test,A,2024-04-01,,,hr_admin`);
    expect(rows[0].role).toBe("hr_admin");
  });

  it("treats an empty file as missing every required column", () => {
    expect(parseImportFile("").missingColumns).toEqual([...REQUIRED_COLUMNS]);
  });
});

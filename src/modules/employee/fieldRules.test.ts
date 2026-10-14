import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { employeeErrorMessage } from "./contracts";
import { aadhaarIsValid, checkField, FIELD_RULES, RULE_MESSAGES } from "./fieldRules";

/**
 * The field rules (D103). The same values the SQL suite tries against the
 * database's own rules (verify_field_checks.sql), so the screen and the
 * database agree about what is right; and a check that every rule the
 * database can name has words on the screen.
 */

const ok = (rule: keyof typeof FIELD_RULES, ...values: string[]) =>
  values.forEach((v) => expect(checkField(rule, v), `${rule}: ${v}`).toBeNull());
const bad = (rule: keyof typeof FIELD_RULES, ...values: string[]) =>
  values.forEach((v) =>
    expect(checkField(rule, v), `${rule}: ${v}`).toBe(FIELD_RULES[rule].message),
  );

describe("each rule, the right way and the wrong ways", () => {
  it("a phone: ten digits, +91 and ten, or another country code with 8 to 15", () => {
    ok("phone", "9876543210", "+91 98765 43210", "98765-43210", "(+91) 98765 43210");
    ok("phone", "+971 50 123 4567", "+1 415 555 0100");
    // Every way of being wrong is named (D104), so a fix that is still wrong
    // is never told the same thing as before.
    const said = (v: string) => checkField("phone", v);
    expect(said("34654365465")).toBe("A mobile number has 10 digits; this has 11.");
    expect(said("987654321")).toBe("A mobile number has 10 digits; this has 9.");
    expect(said("3465436546")).toBe(
      "An Indian mobile number starts with 6, 7, 8 or 9. For another country, start with + and its code.",
    );
    expect(said("5876543210")).toContain("starts with 6, 7, 8 or 9");
    expect(said("09876543210")).toBe(
      "Leave out the 0 at the start: a mobile number has 10 digits.",
    );
    expect(said("+91 5876543210")).toBe("An Indian mobile number starts with 6, 7, 8 or 9.");
    expect(said("+91 98765 432101")).toBe("After +91 a mobile number has 10 digits; this has 11.");
    for (const v of ["abc9876543", "98765 4321x", "98765.43210", "+"]) {
      expect(said(v), v).toBe(
        "Digits only. Spaces, dashes and brackets are fine; letters and other symbols aren't.",
      );
    }
    expect(said("+1234567")).toBe(
      "After + comes the country code and the number: 8 to 15 digits in all.",
    );
  });

  it("a name: letters in any script, spaces and . ' -", () => {
    ok("name", "Priya", "D'Souza", "Anne-Marie", "K. S. Rao", "प्रिया शर्मा", "தமிழ்செல்வி");
    bad("name", "Priya2", "Ravi@home", "...", "R_avi", "Rao, K", "a".repeat(101));
  });

  it("words are names of things, up to 60", () => {
    ok("words", "Tamil Nadu", "Indian", "Sister");
    bad("words", "Kerala!", "Brother1", "x".repeat(61));
  });

  it("an employee code", () => {
    ok("employeeCode", "EMP-001", "A/12", "X.9_2", "34324");
    bad("employeeCode", "EMP 01", "#1", "-12", "9".repeat(31));
  });

  it("an email, a pincode, and body measurements in their ranges", () => {
    ok("email", "a@b.co");
    bad("email", "nisha.acme.test", "a@b", "a b@c.d");
    ok("pincode", "635109");
    bad("pincode", "035109", "63510", "6351090", "63510x");
    ok("heightCm", "50", "175", "260");
    bad("heightCm", "49", "261", "5ft", "175.5", "-1");
    ok("chestCm", "30", "200");
    bad("chestCm", "29", "201");
    ok("weightKg", "10", "400");
    bad("weightKg", "9", "401");
  });

  it("a date of birth fourteen years ago at the latest, and no other date in the future", () => {
    const yearsAgo = (n: number, days = 0) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - n);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    ok("dateOfBirth", yearsAgo(14, -1), "1990-05-01");
    bad("dateOfBirth", yearsAgo(14, 2), yearsAgo(10), "1899-12-31");
    ok("pastDate", yearsAgo(0, -1));
    bad("pastDate", yearsAgo(0, 2));
  });

  it("the statutory and bank numbers, cleaned up as the database cleans them", () => {
    ok("aadhaar", "234567890124", "2345 6789 0124");
    bad("aadhaar", "234567890125", "134567890124", "23456789012");
    ok("pan", "ABCDE1234F", "abcde1234f");
    bad("pan", "ABCDE12345", "ABCD1234F");
    ok("uan", "100000000001");
    bad("uan", "10000000001");
    ok("esic", "1234567890", "12345678901234567");
    bad("esic", "123456789012");
    ok("epf", "MHBAN0012345000001234", "MH/BAN/0012345/000/0001234");
    bad("epf", "MH12345");
    ok("ifsc", "HDFC0001234", "hdfc0001234");
    bad("ifsc", "HDFC1001234", "HDF0001234");
    ok("account", "123456789", "123456789012345678");
    bad("account", "12345678", "1234567890123456789");
    ok("percent", "0", "40", "100", "33.33");
    bad("percent", "101", "-5", "forty", "33.333");
  });

  it("checks Aadhaar's checksum as aadhaar_is_valid does", () => {
    expect(aadhaarIsValid("234567890124")).toBe(true);
    // Every single-digit slip in its last place is caught.
    for (let d = 0; d <= 9; d++) {
      if (d === 4) continue;
      expect(aadhaarIsValid(`23456789012${d}`)).toBe(false);
    }
  });

  it("never judges an empty value: whether a field is required is the form's call", () => {
    for (const rule of Object.keys(FIELD_RULES) as (keyof typeof FIELD_RULES)[]) {
      expect(checkField(rule, "   ")).toBeNull();
    }
  });
});

describe("the exact edges (found unpinned by mutation testing)", () => {
  it("allows exactly the maximum length, and not one more", () => {
    ok("text100", "x".repeat(100));
    bad("text100", "x".repeat(101));
    ok("text200", "x".repeat(200));
    bad("text200", "x".repeat(201));
    ok("text500", "x".repeat(500));
    bad("text500", "x".repeat(501));
    ok("words", "a".repeat(60));
    ok("name", "a".repeat(100));
  });

  it("is anchored at both ends: nothing before or after the pattern", () => {
    bad("email", "x a@b.co", "a@b.co x");
    bad("pan", "ABCDE1234FX", "XABCDE1234F");
    bad("uan", "1000000000012", "0100000000001x1");
    bad("epf", "1MHBAN0012345", "MHBAN0012345000001234567");
    bad("ifsc", "HDFC0001234X", "XHDFC0001234");
    expect(aadhaarIsValid("2345678901240")).toBe(false);
  });

  it("puts the age and date limits exactly where they are", () => {
    const yearsAgo = (n: number) => {
      const t = new Date();
      return new Date(Date.UTC(t.getFullYear() - n, t.getMonth(), t.getDate()))
        .toISOString()
        .slice(0, 10);
    };
    ok("dateOfBirth", yearsAgo(14), "1900-01-02");
    bad("dateOfBirth", "1900-01-01");
    ok("pastDate", yearsAgo(0));
  });

  it("has words for every rule", () => {
    for (const [rule, { message }] of Object.entries(FIELD_RULES)) {
      expect(message.length, rule).toBeGreaterThan(15);
    }
    for (const [rule, message] of Object.entries(RULE_MESSAGES)) {
      expect(message.length, rule).toBeGreaterThan(15);
    }
  });
});

describe("every rule the database names has words on the screen", () => {
  it("covers each rule in 20261023100000_fields_are_checked.sql", () => {
    const sql = readFileSync("supabase/migrations/20261023100000_fields_are_checked.sql", "utf8");
    const named = [...sql.matchAll(/field_check\([\s\S]*?'([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(25);
    expect(named.filter((r) => !RULE_MESSAGES[r])).toEqual([]);
  });

  it("turns a refused value's rule into its field's message", () => {
    expect(employeeErrorMessage("INVALID_VALUE", "alternate_mobile_format")).toBe(
      `Alternate mobile: ${FIELD_RULES.phone.message}`,
    );
    expect(employeeErrorMessage("INVALID_VALUE", "something_unknown")).toBe(
      "One of those values isn't allowed. Check the fields and try again.",
    );
    expect(employeeErrorMessage("DEPARTMENT_NOT_FOUND")).toBe(
      "That department isn't on your company's list any more.",
    );
    expect(employeeErrorMessage("REPORTING_CYCLE")).toContain("loop");
  });
});

import { describe, expect, it } from "vitest";
import { EmailInput, VerifyOtpInput, SignupInput, PhoneInput, suggestSlug } from "./contracts";
import { hasRole, isAdmin, canApprove } from "./session";
import type { CurrentUser } from "./contracts";

function user(roles: CurrentUser["roles"]): CurrentUser {
  return {
    id: "u1",
    email: "a@b.test",
    fullName: "A",
    organizationId: "o1",
    organizationName: "Org",
    roles,
  };
}

describe("PhoneInput — India only, by decision", () => {
  it("accepts the ways an administrator types the same number", () => {
    // All four are one person. The point of the test is the right-hand side:
    // they must come out identical, or the uniqueness index on
    // phone_normalized is comparing three different strings for one human.
    for (const typed of ["9876543210", "+919876543210", "+91 98765 43210", "09876543210"]) {
      expect(PhoneInput.parse(typed)).toBe("+919876543210");
    }
  });

  it("strips the separators people actually type", () => {
    expect(PhoneInput.parse("(98765) 43210")).toBe("+919876543210");
    expect(PhoneInput.parse("98765-43210")).toBe("+919876543210");
    expect(PhoneInput.parse("  +91 98765 43210  ")).toBe("+919876543210");
  });

  it("refuses letters", () => {
    // The rule this replaced stripped non-digits and then counted, so it asked
    // only "are there ten digits in here somewhere" — and both of these said
    // yes. Letters are deliberately NOT stripped before the check.
    expect(() => PhoneInput.parse("abc9876543210xyz")).toThrow();
    expect(() => PhoneInput.parse("98765ABCDE")).toThrow();
  });

  it("refuses the wrong number of digits", () => {
    expect(() => PhoneInput.parse("987654321")).toThrow(); // nine
    expect(() => PhoneInput.parse("98765432101")).toThrow(); // eleven
    expect(() => PhoneInput.parse("1234567890123456")).toThrow();
  });

  it("refuses a number that cannot be an Indian mobile", () => {
    // Mobiles open 6-9. A landline reaches a desk, and this field exists to
    // reach a person — and to carry a phone OTP when D8 lands.
    expect(() => PhoneInput.parse("1234567890")).toThrow();
    expect(() => PhoneInput.parse("5876543210")).toThrow();
    expect(PhoneInput.parse("6876543210")).toBe("+916876543210");
  });

  it("refuses a foreign number, which is the whole point of this round", () => {
    // Both were ACCEPTED by the previous rule. When Neuvto goes global these
    // are the tests that have to be deleted on purpose rather than quietly
    // stop being true.
    expect(() => PhoneInput.parse("+44 20 7946 0958")).toThrow();
    expect(() => PhoneInput.parse("+1 415 555 0132")).toThrow();
  });

  it("accepts empty, because phone is optional", () => {
    // D41: captured, not verified, not an identity key. Requiring it would
    // block an invitation over a field that does no work yet.
    expect(PhoneInput.parse("")).toBe("");
  });
});

describe("EmailInput", () => {
  it("normalises case and whitespace so the same person is one account", () => {
    expect(EmailInput.parse({ email: "  Founder@Testco.Example " }).email).toBe(
      "founder@testco.example",
    );
  });

  it("rejects a non-email", () => {
    expect(() => EmailInput.parse({ email: "not-an-email" })).toThrow();
  });
});

describe("VerifyOtpInput", () => {
  it("accepts exactly six digits", () => {
    expect(VerifyOtpInput.parse({ email: "a@b.test", token: "041159" }).token).toBe("041159");
  });

  it.each([["12345"], ["1234567"], ["12a456"], [""]])("rejects %s", (token) => {
    expect(() => VerifyOtpInput.parse({ email: "a@b.test", token })).toThrow();
  });
});

describe("SignupInput", () => {
  const base = { organizationName: "Testco Facilities Ltd", slug: "testco", fullName: "Sam" };

  it("accepts a valid workspace", () => {
    expect(SignupInput.parse(base).slug).toBe("testco");
  });

  it("lowercases the slug, because the database stores it lowercase", () => {
    expect(SignupInput.parse({ ...base, slug: "TestCo" }).slug).toBe("testco");
  });

  it("requires a company name", () => {
    expect(() => SignupInput.parse({ ...base, organizationName: "   " })).toThrow();
  });

  // These mirror the organizations_slug_format CHECK constraint. If the two
  // drift, the database rejects input the form accepted and the user sees an
  // unexplained failure — so the rules are asserted, not assumed.
  it.each([
    ["-leading-hyphen"],
    ["has space"],
    ["has_underscore"],
    ["Has.Dot"],
    ["a"], // shorter than the 2-character minimum
  ])("rejects slug %s", (slug) => {
    expect(() => SignupInput.parse({ ...base, slug })).toThrow();
  });

  it("accepts internal hyphens and digits", () => {
    expect(SignupInput.parse({ ...base, slug: "acme-2-security" }).slug).toBe("acme-2-security");
  });
});

describe("suggestSlug", () => {
  it("derives a usable slug from a company name", () => {
    expect(suggestSlug("Testco Facilities Ltd")).toBe("testco-facilities-ltd");
  });

  it("collapses punctuation rather than emitting it", () => {
    expect(suggestSlug("Acme & Co. Security!")).toBe("acme-co-security");
  });

  it("never produces leading or trailing hyphens, which the constraint rejects", () => {
    const s = suggestSlug("  ***Acme***  ");
    expect(s).toBe("acme");
    expect(SignupInput.parse({ organizationName: "Acme", slug: s }).slug).toBe("acme");
  });

  it("stays within the 63-character limit", () => {
    expect(suggestSlug("a".repeat(200)).length).toBeLessThanOrEqual(63);
  });
});

describe("role helpers", () => {
  it("treats both admin roles as admin, mirroring the database is_admin()", () => {
    expect(isAdmin(user(["org_admin"]))).toBe(true);
    expect(isAdmin(user(["hr_admin"]))).toBe(true);
    expect(isAdmin(user(["manager"]))).toBe(false);
    expect(isAdmin(user(["employee"]))).toBe(false);
  });

  it("lets managers and admins approve, but not employees", () => {
    expect(canApprove(user(["manager"]))).toBe(true);
    expect(canApprove(user(["org_admin"]))).toBe(true);
    expect(canApprove(user(["employee"]))).toBe(false);
  });

  it("is safe when signed out", () => {
    expect(isAdmin(null)).toBe(false);
    expect(canApprove(null)).toBe(false);
    expect(hasRole(null, "org_admin")).toBe(false);
  });

  it("handles someone holding several roles", () => {
    const u = user(["employee", "manager"]);
    expect(canApprove(u)).toBe(true);
    expect(isAdmin(u)).toBe(false);
  });
});

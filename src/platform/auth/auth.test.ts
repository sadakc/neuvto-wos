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

describe("PhoneInput", () => {
  // Every rejection here was accepted before, and was found by typing into the
  // invite form rather than by reading the rule.
  it("refuses letters", () => {
    // The old rule stripped non-digits and then counted, so this asked only
    // "are there six digits in here somewhere" — and this string says yes.
    expect(() => PhoneInput.parse("abc123456xyz")).toThrow();
    expect(() => PhoneInput.parse("98765ABCDE")).toThrow();
  });

  it("refuses more digits than a phone number can have", () => {
    // E.164 allows 15 digits including the country code. Sixteen is not a long
    // phone number, it is a typo or a different field's contents.
    expect(() => PhoneInput.parse("1234567890123456")).toThrow();
  });

  it("accepts the formats an administrator actually types", () => {
    for (const v of [
      "+91 98765 43210",
      "+919876543210",
      "9876543210",
      "(020) 7946-0958",
      "+44 20 7946 0958",
    ]) {
      expect(PhoneInput.parse(v)).toBe(v);
    }
  });

  it("accepts empty, because phone is optional", () => {
    // D41: captured, not verified, and not an identity key. Requiring it would
    // block an invitation over a field that does no work yet.
    expect(PhoneInput.parse("")).toBe("");
  });

  it("accepts exactly 15 digits and refuses 5", () => {
    // The boundaries, stated once so a later tightening has to argue with them.
    expect(PhoneInput.parse("+123456789012345")).toBe("+123456789012345");
    expect(() => PhoneInput.parse("12345")).toThrow();
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

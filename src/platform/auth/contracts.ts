/**
 * Auth contracts.
 *
 * Zod schemas are the single source of truth; types are derived from them so a
 * schema and its type cannot drift (NEUVTO_CODING_STANDARDS.md §3).
 */

import { z } from "zod";

/**
 * Mirrors the `app_role` enum. Order is display order — administrators first,
 * then the roles that approve, then the one that does not.
 *
 * Supervisor and Coordinator arrived 7 Aug 2026 at Sada's request. They APPROVE
 * and they do not ADMINISTER: `canApprove` includes them, `isAdmin` does not.
 * Officer was asked for and then withdrawn once the cost was clear — a Postgres
 * enum value can be added but never removed, so it waits until it is wanted.
 */
export const APP_ROLES = [
  "org_admin",
  "hr_admin",
  "manager",
  "supervisor",
  "coordinator",
  "employee",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * What each role is CALLED on screen. One definition, because there were four.
 *
 * InviteTeam's own header complains that a fourth copy of the invite form would
 * be "a fourth place for the wording to drift" — and four copies of this map had
 * quietly appeared underneath it. Adding two roles is what surfaced them: three
 * were `Record<AppRole, string>` and failed typecheck immediately, and the
 * fourth, on the dashboard, was `Record<string, string>` and would have rendered
 * NOTHING for a Supervisor while compiling perfectly.
 *
 * `Record<AppRole, string>` here means the next role added cannot be forgotten
 * anywhere — the compiler names every screen that has to say something about it.
 */
export const ROLE_LABELS: Record<AppRole, string> = {
  org_admin: "Administrator",
  hr_admin: "HR administrator",
  manager: "Manager",
  supervisor: "Supervisor",
  coordinator: "Coordinator",
  employee: "Employee",
};

export const EmailInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(320),
});
export type EmailInput = z.infer<typeof EmailInput>;

export const VerifyOtpInput = EmailInput.extend({
  // Supabase issues 6-digit email OTPs.
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});
export type VerifyOtpInput = z.infer<typeof VerifyOtpInput>;

/**
 * Slug rules mirror the `organizations_slug_format` CHECK constraint exactly.
 * If they drift, the database rejects input the form accepted and the user sees
 * an unexplained failure.
 */
export const SignupInput = z.object({
  organizationName: z
    .string()
    .trim()
    .min(1, "Enter your company name")
    .max(200, "Company name is too long"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Workspace address must be at least 2 characters")
    .max(63, "Workspace address is too long")
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Use lowercase letters, numbers and hyphens, starting with a letter or number",
    ),
  fullName: z.string().trim().max(200).optional().default(""),
});
export type SignupInput = z.infer<typeof SignupInput>;

/**
 * An Indian mobile number, stored in one canonical shape.
 *
 * India only, by decision — Sada, 3 Aug 2026: "I need India specific
 * restriction on phone number right now and I will think about going global
 * later." The country rule therefore lives HERE and nowhere else. Deliberately
 * not a check constraint in the database: going global later should be an edit
 * to one file, not a migration against every customer's data.
 *
 * ── the shape
 *
 * Ten digits opening 6, 7, 8 or 9, which is every Indian mobile. An optional
 * +91, 91 or leading 0 is accepted because administrators type all three, and
 * discarded because they all mean the same number.
 *
 * Landlines are refused. That is a consequence worth stating rather than
 * discovering: this field exists to tell one human from another and to carry a
 * phone OTP when D8 lands, and an OTP to a desk phone reaches a desk.
 *
 * ── why it CANONICALISES rather than just validating
 *
 * `profiles.phone_normalized` is `regexp_replace(phone, '[^0-9+]', '', 'g')`,
 * and a unique index sits on it. That strips punctuation but not the country
 * code, so the same person typed three ways produced three different keys:
 *
 *     9876543210      -> 9876543210
 *     +91 98765 43210 -> +919876543210
 *     09876543210     -> 09876543210
 *
 * The index was doing nothing for the case it exists to catch — inviting one
 * human twice. Everything now leaves here as `+919876543210`, so the stored
 * value is the same string whichever way it was typed, and the uniqueness rule
 * means what D41 says it means.
 *
 * Done now because there are currently zero phone numbers in any environment.
 * The same change against real data is a backfill and a duplicate-resolution
 * problem.
 *
 * Still NOT verified, and still not an identity key (D41). Making it one needs
 * phone OTP, which D8 defers pending a provider and Indian DLT registration.
 */
const INDIAN_MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;
export const PhoneInput = z
  .string()
  .trim()
  // Separators are stripped BEFORE the shape is judged, so "98765 43210" and
  // "(98765) 43210" are the same number rather than two rejections. Letters are
  // not stripped — removing them would silently turn `abc9876543210` into a
  // valid number, which is how the previous rule came to accept it.
  .transform((v) => v.replace(/[\s().-]/g, ""))
  .refine(
    (v) => v === "" || INDIAN_MOBILE.test(v),
    "Enter a 10-digit Indian mobile number — it should start with 6, 7, 8 or 9",
  )
  // One shape out, whatever went in. See the note above the regex.
  .transform((v) => {
    const m = v.match(INDIAN_MOBILE);
    return m ? `+91${m[1]}` : "";
  });

/** Provisioning a customer workspace. Platform admins only — see `platform.ts`. */
export const ProvisionInput = SignupInput.extend({
  adminEmail: z.string().trim().toLowerCase().email("Enter the administrator's email address"),
  adminPhone: PhoneInput.optional().default(""),
  adminName: z.string().trim().max(200).optional().default(""),
});
export type ProvisionInput = z.infer<typeof ProvisionInput>;

/**
 * Inviting somebody into the caller's own workspace.
 *
 * `fullName` is REQUIRED, from 7 Aug 2026 — Sada: "The name cannot be optional.
 * Make it a regular one."
 *
 * It was optional because an invitation needs only an address to be deliverable.
 * That is true and it is not the point: the name is what every other screen
 * identifies a person BY. `members.tsx` falls back to `m.fullName || m.email`,
 * so a workspace invited without names is a list of email addresses — in the
 * approval timeline, the reporting-line dropdown, the successor picker on
 * deactivation, and every report. The address is a login, not a person.
 *
 * `invitation_create` refuses a blank one too, so this is not the only guard.
 * Provisioning is unaffected: `provision_organization` writes to `invitations`
 * directly rather than through that function, deliberately, and a platform admin
 * naming a customer's first administrator is a different decision from a
 * customer naming their own colleague.
 */
export const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(320),
  phone: PhoneInput.optional().default(""),
  role: z.enum(APP_ROLES),
  fullName: z
    .string()
    .trim()
    .min(1, "Enter their name — it is how they appear on every screen")
    .max(200, "That name is too long"),
  /**
   * D58. Optional, and empty is the honest default — a workspace that has not
   * configured any departments cannot place anybody, and requiring one would
   * make the first invitation impossible. Carried on the invitation and applied
   * to the profile at acceptance (D53), like the start date and reporting line.
   */
  departmentId: z.string().uuid().nullable().optional().default(null),
});
export type InviteInput = z.infer<typeof InviteInput>;

/** The signed-in user as the app needs them: identity, tenant and roles in one object. */
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  organizationId: string;
  organizationName: string;
  roles: AppRole[];
}

/** Derives a slug suggestion from a company name. Advisory only — the user can edit it. */
export function suggestSlug(organizationName: string): string {
  return organizationName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

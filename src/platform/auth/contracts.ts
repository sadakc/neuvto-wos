/**
 * Auth contracts.
 *
 * Zod schemas are the single source of truth; types are derived from them so a
 * schema and its type cannot drift (NEUVTO_CODING_STANDARDS.md §3).
 */

import { z } from "zod";

export const APP_ROLES = ["org_admin", "hr_admin", "manager", "employee"] as const;
export type AppRole = (typeof APP_ROLES)[number];

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
 * A phone number as an administrator types it.
 *
 * Deliberately permissive about shape: international formats vary far more than
 * any regex written in one country accounts for, and rejecting a valid number is
 * worse than storing an odd-looking one. The database normalises to digits and a
 * leading + for its uniqueness rule.
 *
 * This is NOT verified, and is not an identity key (D41). Making it one needs
 * phone OTP, which D8 defers.
 */
export const PhoneInput = z
  .string()
  .trim()
  // Permissive about SHAPE, not about content. The previous rule stripped every
  // non-digit before counting, so it asked "are there six digits in here
  // somewhere" — and `abc123456xyz` answered yes. Separators people genuinely
  // type are allowed; letters are not, because no phone number contains one.
  .refine(
    (v) => v === "" || /^\+?[\d\s().-]+$/.test(v),
    "A phone number can only contain digits, spaces, and + ( ) - .",
  )
  // E.164 caps a full international number at 15 digits, country code included.
  // The old rule bounded the STRING at 32 characters and the digits not at all,
  // which is how a 15-digit number typed twice got through.
  .refine((v) => {
    if (v === "") return true;
    const digits = v.replace(/\D/g, "").length;
    return digits >= 6 && digits <= 15;
  }, "That doesn't look like a phone number — it should be 6 to 15 digits")
  .refine((v) => v.length <= 32, "That phone number is too long");

/** Provisioning a customer workspace. Platform admins only — see `platform.ts`. */
export const ProvisionInput = SignupInput.extend({
  adminEmail: z.string().trim().toLowerCase().email("Enter the administrator's email address"),
  adminPhone: PhoneInput.optional().default(""),
  adminName: z.string().trim().max(200).optional().default(""),
});
export type ProvisionInput = z.infer<typeof ProvisionInput>;

/** Inviting somebody into the caller's own workspace. */
export const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(320),
  phone: PhoneInput.optional().default(""),
  role: z.enum(APP_ROLES),
  fullName: z.string().trim().max(200).optional().default(""),
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

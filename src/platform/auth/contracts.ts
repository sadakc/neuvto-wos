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

/**
 * Platform · Company identity
 *
 * What a workspace calls itself and what it looks like. D45 — identity now,
 * theming still deferred (D15): every colour already resolves through a CSS
 * variable, so per-organisation palettes remain additive whenever they are
 * wanted.
 *
 * `name` is the registered company name, the one on a contract.
 * `displayName` is what the workspace calls itself, and is what people see.
 * Everything on screen and in email goes through `companyName()` below so the
 * fallback is decided in one place.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";

export interface Organization {
  id: string;
  /** Registered company name. */
  name: string;
  /** What the workspace calls itself. Null means "use the registered name". */
  displayName: string | null;
  slug: string;
  industryType: string | null;
  logoPath: string | null;
  logoUpdatedAt: string | null;
  onboardingCompletedAt: string | null;
}

/** The name to show. One definition, so no screen invents its own fallback. */
export function companyName(org: Organization | null): string {
  if (!org) return "";
  return org.displayName?.trim() || org.name;
}

export async function getOrganization(): Promise<Organization | null> {
  // RLS scopes this to the caller's own organisation.
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, name, display_name, slug, industry_type, logo_path, logo_updated_at, onboarding_completed_at",
    )
    .maybeSingle();

  if (error) throw toAppError(error, "getOrganization");
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    displayName: data.display_name,
    slug: data.slug,
    industryType: data.industry_type,
    logoPath: data.logo_path,
    logoUpdatedAt: data.logo_updated_at,
    onboardingCompletedAt: data.onboarding_completed_at,
  };
}

/**
 * Saves identity. Only the columns an administrator is granted — `slug` and
 * `deleted_at` are not among them, and asking for either fails at the database
 * rather than here.
 */
export async function updateOrganization(
  id: string,
  patch: { name?: string; displayName?: string | null; industryType?: string | null },
): Promise<void> {
  // Typed rather than a loose record, so the generated schema decides which
  // columns exist. A Record<string, unknown> compiles happily against a column
  // name that was renamed three migrations ago.
  const row: {
    name?: string;
    display_name?: string | null;
    industry_type?: string | null;
  } = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.displayName !== undefined) row.display_name = patch.displayName?.trim() || null;
  if (patch.industryType !== undefined) row.industry_type = patch.industryType?.trim() || null;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from("organizations").update(row).eq("id", id);
  if (error) {
    if (error.message.includes("organizations_display_name_sane")) {
      throw new AppError("VALIDATION_FAILED", "Keep the display name under 60 characters.", 400, {
        field: "displayName",
      });
    }
    if (error.message.includes("organizations_name_not_blank")) {
      throw new AppError("VALIDATION_FAILED", "The company name can't be blank.", 400, {
        field: "name",
      });
    }
    throw toAppError(error, "updateOrganization");
  }
}

/** Records that they chose to finish setup (D46). What is DONE is derived elsewhere. */
export async function completeOnboarding(id: string): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw toAppError(error, "completeOnboarding");
}

// ────────────────────────────────────────────────────────────────── the logo

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"] as const;
/** Generous for a header mark, small enough that nobody ships a 4000px original. */
const MAX_EDGE = 512;

/**
 * Re-encodes the image through a canvas rather than uploading what was chosen.
 *
 * An uploaded file is somebody else's bytes. Redrawing it discards EXIF —
 * which routinely carries the location a photo was taken — along with any
 * trailing data appended after the image, and guarantees the result really is
 * the format its content type claims. It also caps the dimensions, so a logo
 * cannot be a 12-megapixel photograph that every employee downloads on every
 * page load.
 *
 * SVG is refused by the bucket, not handled here: an SVG is a document that can
 * carry script, and there is no re-encoding that makes that safe.
 */
async function normalise(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AppError("INTERNAL_ERROR", "We couldn't process that image.", 500);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // PNG throughout: logos have flat colour and hard edges, which JPEG smears,
  // and transparency, which JPEG cannot represent at all.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new AppError("INTERNAL_ERROR", "We couldn't process that image.", 500);
  return blob;
}

/**
 * Uploads a logo and records its path.
 *
 * The path is `{organizationId}/logo.png`, which is what makes the storage
 * policy a prefix match rather than a guess — and why `organizations_logo_path_scoped`
 * refuses a path belonging to anyone else.
 */
export async function uploadLogo(organizationId: string, file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type as (typeof ACCEPTED)[number])) {
    throw new AppError("VALIDATION_FAILED", "Choose a PNG, JPEG or WebP image.", 400, {
      field: "logo",
    });
  }
  if (file.size > MAX_BYTES) {
    throw new AppError("VALIDATION_FAILED", "That image is larger than 2 MB.", 400, {
      field: "logo",
    });
  }

  const blob = await normalise(file);
  const path = `${organizationId}/logo.png`;

  const { error: upErr } = await supabase.storage
    .from("org-logos")
    .upload(path, blob, { contentType: "image/png", upsert: true });

  if (upErr) {
    // The bucket's own limits refuse before RLS does; both produce a 4xx here
    // and neither is worth showing verbatim.
    throw new AppError("VALIDATION_FAILED", "That image couldn't be uploaded.", 400, {
      field: "logo",
    });
  }

  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: path, logo_updated_at: new Date().toISOString() })
    .eq("id", organizationId);
  if (error) throw toAppError(error, "uploadLogo");

  return path;
}

export async function removeLogo(organizationId: string, path: string): Promise<void> {
  await supabase.storage.from("org-logos").remove([path]);
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: null, logo_updated_at: null })
    .eq("id", organizationId);
  if (error) throw toAppError(error, "removeLogo");
}

/**
 * A short-lived URL for a private object.
 *
 * The bucket is not public, so there is no permanent address — which is the
 * point. `logoUpdatedAt` is appended so a replaced logo is not served from a
 * cache showing the old one.
 */
export async function getLogoUrl(
  path: string | null,
  updatedAt?: string | null,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("org-logos").createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return updatedAt ? `${data.signedUrl}#${Date.parse(updatedAt)}` : data.signedUrl;
}

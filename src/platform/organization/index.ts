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
import { z } from "zod";

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

/**
 * Anything on screen showing the company's identity, told that it changed.
 *
 * The app shell reads the organisation once when it mounts, and the shell does
 * NOT remount when the page inside it changes. So renaming the company in
 * Settings, or finishing the setup wizard, left the old name and the old logo
 * in the header until a full page load. Caught by walking the wizard: the
 * banner said "Testco is ready" while the header above it still said "Testco
 * Facilities".
 *
 * A fifteen-line emitter rather than a state library: exactly one producer, one
 * consumer, and no history to replay.
 */
type IdentityListener = () => void;
const identityListeners = new Set<IdentityListener>();

export function identityChanged(): void {
  for (const listener of identityListeners) listener();
}

export function onIdentityChange(cb: IdentityListener): () => void {
  identityListeners.add(cb);
  return () => {
    identityListeners.delete(cb);
  };
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

// ───────────────────────────────────────────────────────────── departments
//
// The write side that never existed. The table has been there since the first
// migration — RLS, an admin write policy, grants, a parent column, a foreign key
// from `profiles` — and nothing in the product ever wrote a row. So the
// Department column on both leave reports was blank for everybody, and the
// spreadsheet import validated names against a permanently empty list and warned
// on every row that named one.
//
// These live here rather than in a `departments.ts` for a dull but real reason:
// the component is `Departments.tsx`, and on a case-insensitive filesystem —
// which macOS is by default — `departments.ts` and `Departments.tsx` are the
// same path. TypeScript says so out loud. `CompanyIdentity.tsx` sitting beside
// its handlers in this file is the convention already, and this follows it.

export interface Department {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  /** How many active people are in it. Drives the warning before removal. */
  memberCount: number;
}

/** Mirrors `departments_name_not_blank` and the length the column will take. */
export const DepartmentInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give this department a name").max(100, "That name is too long"),
});
export type DepartmentInput = z.infer<typeof DepartmentInput>;

/**
 * Every department, with a head count.
 *
 * Two reads rather than an embed with an aggregate. PostgREST can count a
 * relationship, but only for rows the caller may READ — and `profiles` is
 * visible to a manager for their own reports only, so the same query would
 * return different counts to different people and the number would quietly
 * become "people you can see in this department". An administrator is the only
 * caller here, but a count whose meaning depends on who asks is a trap left for
 * whoever widens the screen later.
 */
export async function listDepartments(): Promise<Department[]> {
  const [departments, people] = await Promise.all([
    supabase.from("departments").select("id, name, parent_department_id").order("name"),
    supabase.from("profiles").select("department_id").eq("is_active", true),
  ]);

  if (departments.error) {
    throw new AppError("INTERNAL_ERROR", "We couldn't load your departments.", 500);
  }

  const counts = new Map<string, number>();
  for (const p of people.data ?? []) {
    if (p.department_id) counts.set(p.department_id, (counts.get(p.department_id) ?? 0) + 1);
  }

  return (departments.data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    parentDepartmentId: d.parent_department_id,
    memberCount: counts.get(d.id) ?? 0,
  }));
}

/**
 * Creates one, or renames it. The organisation comes from the caller's own
 * profile and never from the form — a client-supplied organization_id is a
 * cross-tenant write waiting for the one policy that forgets to check it.
 */
export async function saveDepartment(
  input: DepartmentInput,
  organizationId: string,
): Promise<void> {
  const parsed = DepartmentInput.parse(input);

  const { error } = parsed.id
    ? await supabase.from("departments").update({ name: parsed.name }).eq("id", parsed.id)
    : await supabase
        .from("departments")
        .insert({ organization_id: organizationId, name: parsed.name });

  if (!error) return;

  // uq_department_name is partial and case-insensitive, so "Sales" collides with
  // "sales" and a removed department's name is free again. Worth saying plainly
  // rather than showing an index name.
  if (error.code === "23505" || error.message.includes("uq_department_name")) {
    throw new AppError("VALIDATION_FAILED", "There's already a department with that name.", 400);
  }
  throw toAppError(error, "saveDepartment");
}

/**
 * Removes one, and takes everybody out of it.
 *
 * An RPC because it is two writes that must not come apart: soft-deleting the
 * department alone leaves `profiles.department_id` pointing at a row nobody can
 * read, which reads as "no department" on every screen while the column still
 * holds a live reference.
 */
export async function removeDepartment(id: string): Promise<{ peopleUnassigned: number }> {
  const { data, error } = await supabase.rpc("department_remove", { _id: id });

  if (error) {
    if (error.message.includes("DEPARTMENT_HAS_CHILDREN")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "This department has departments inside it. Remove or move those first.",
        400,
      );
    }
    throw toAppError(error, "removeDepartment");
  }

  const moved = (data as { people_unassigned?: number } | null)?.people_unassigned ?? 0;
  return { peopleUnassigned: moved };
}

/**
 * Puts somebody in a department, or takes them out. `null` clears it.
 *
 * D50 — an administrator editing somebody else goes through a SECURITY DEFINER
 * function. The one it enforces that a foreign key cannot: the department has to
 * belong to the caller's own organisation. A FK constrains existence, not
 * ownership, and every report joining departments would otherwise be able to
 * disclose a name across a tenant boundary.
 */
export async function setDepartment(
  employeeId: string,
  departmentId: string | null,
): Promise<void> {
  // The generated types declare every RPC argument non-nullable — Postgres does
  // not distinguish "has no default" from "may not be null" — and this one
  // genuinely accepts null. The same cast setReportingLine carries, for the same
  // reason.
  const { error } = await supabase.rpc("admin_set_department", {
    _employee_id: employeeId,
    _department_id: departmentId,
  } as unknown as { _employee_id: string; _department_id: string });

  if (!error) return;

  if (error.message.includes("DEPARTMENT_NOT_FOUND")) {
    throw new AppError("NOT_FOUND", "That department no longer exists.", 404);
  }
  throw toAppError(error, "setDepartment");
}

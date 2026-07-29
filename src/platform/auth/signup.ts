/**
 * Organisation signup.
 *
 * Delegates to the `signup_organization` SECURITY DEFINER function, which is
 * the only supported way to create an organisation. It creates the organisation,
 * its settings, the profile and the first org_admin role in one transaction —
 * necessary because the "admins grant roles" policy requires is_admin(), and
 * whoever creates a brand-new organisation has no role yet.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";
import { SignupInput } from "./contracts";

export async function createOrganization(input: unknown): Promise<{ organizationId: string }> {
  const parsed = SignupInput.parse(input);

  const { data, error } = await supabase.rpc("signup_organization", {
    p_org_name: parsed.organizationName,
    p_slug: parsed.slug,
    p_full_name: parsed.fullName ?? "",
  });

  if (error) {
    // The function raises these; map them to codes the UI can branch on, with
    // messages that say what to do next rather than restating the failure.
    if (error.message.includes("ALREADY_IN_ORGANIZATION")) {
      throw new AppError(
        "ALREADY_IN_ORGANIZATION",
        "This account already belongs to a workspace.",
        409,
      );
    }
    if (error.message.includes("UNAUTHENTICATED")) {
      throw new AppError("UNAUTHENTICATED", "Please sign in again to continue.", 401);
    }
    // Raised by the organizations_slug unique constraint.
    if (error.code === "23505" || error.message.includes("organizations_slug_key")) {
      throw new AppError(
        "SLUG_TAKEN",
        "That workspace address is already taken. Try another.",
        409,
        { field: "slug" },
      );
    }
    // Raised by organizations_slug_format when the client-side rule and the
    // database rule have drifted apart.
    if (error.message.includes("organizations_slug_format")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Use lowercase letters, numbers and hyphens only.",
        400,
        { field: "slug" },
      );
    }
    throw toAppError(error, "createOrganization");
  }

  if (!data) {
    throw new AppError("INTERNAL_ERROR", "Workspace could not be created.", 500);
  }
  return { organizationId: data as string };
}

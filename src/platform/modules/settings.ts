/**
 * Platform · Module settings
 *
 * D7 finally being used. `module_settings` has existed since the first
 * migration — organisation, module key, setting key, jsonb — and until now
 * nothing read or wrote it: `settingsSchema` sat on every manifest and was
 * validated by the registry at boot, describing configuration that had nowhere
 * to live. Payroll's pay schedule is the first thing that needs it.
 *
 * One row per module, under the setting key `settings`, holding the whole
 * object the manifest's schema describes. The table's key/value shape allows
 * finer grain and a module may take it later; a single validated object is what
 * `settingsSchema` already promises, and one schema parsed in one place is
 * harder to get quietly wrong than a scatter of independently-typed keys.
 *
 * **Every field must carry a `.default()`.** Absence is the normal case — a
 * workspace that has never opened a settings screen still has to be paid — so
 * these functions answer with the schema's own defaults rather than null, and a
 * schema that cannot parse `{}` is a schema that turns "never configured" into
 * an error somebody meets on a payslip.
 *
 * Reads are open to the whole organisation and writes are not: an employee has
 * to be able to learn when they will be paid, and must not be able to change
 * it. That is the RLS policy's job, not this file's — there is no admin check
 * here, because a check here would imply the policy is not trusted.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError } from "@/platform/errors";
import { moduleByKey } from "./registry";

/** One row per module. The table permits more; nothing needs more yet. */
const SETTING_KEY = "settings";

function schemaFor(moduleKey: string) {
  const definition = moduleByKey(moduleKey);
  if (!definition) {
    // A caller naming a module this build does not have is a developer error,
    // and a silent empty object would let it reach a screen as a mysteriously
    // unconfigurable one.
    throw new AppError("NOT_FOUND", "That module isn't installed.", 404);
  }
  return definition.settingsSchema;
}

/**
 * This organisation's configuration for one module, with every unset field
 * filled from the schema.
 *
 * Stored configuration is parsed rather than trusted. It is jsonb written by a
 * previous version of a screen, and a field that changed shape between releases
 * would otherwise reach a component as the wrong type — so a row that no longer
 * fits its schema is treated as unconfigured and the defaults win. Losing an
 * unreadable setting is recoverable; rendering a pay date from a string that
 * used to be a number is not.
 */
export async function getModuleSettings<T>(moduleKey: string): Promise<T> {
  const schema = schemaFor(moduleKey);

  const { data, error } = await supabase
    .from("module_settings")
    .select("value")
    .eq("module_key", moduleKey)
    .eq("setting_key", SETTING_KEY)
    .maybeSingle();

  // RLS scopes this to the caller's organisation, so no organisation filter is
  // needed here — and none should be added, because a filter in application
  // code implies the policy cannot be trusted.
  if (error) throw toAppError(error, "getModuleSettings");

  const stored = schema.safeParse(data?.value ?? {});
  if (stored.success) return stored.data as T;

  return schema.parse({}) as T;
}

/**
 * Replaces this organisation's configuration for one module.
 *
 * Validated here as well as by the form that called it: this is the last point
 * before the value becomes jsonb, and jsonb accepts anything. RLS ("admins
 * write module settings") is what refuses a non-administrator.
 */
export async function saveModuleSettings<T>(
  organizationId: string,
  moduleKey: string,
  value: T,
): Promise<T> {
  const schema = schemaFor(moduleKey);

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "Those settings couldn't be saved.", 400);
  }

  const { error } = await supabase.from("module_settings").upsert(
    {
      organization_id: organizationId,
      module_key: moduleKey,
      setting_key: SETTING_KEY,
      value: parsed.data as never,
      deleted_at: null,
    },
    { onConflict: "organization_id,module_key,setting_key" },
  );

  if (error) throw toAppError(error, "saveModuleSettings");
  return parsed.data as T;
}

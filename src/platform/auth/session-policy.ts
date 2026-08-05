import { supabase } from "@/integrations/supabase/client";

/**
 * How long this caller's session may last, from the database.
 *
 * NOT from `getOrgSettings()`, even though the two columns live on
 * `organization_settings`. Neuvto staff have no profile and therefore no
 * settings row (D42), so that read returns null for them under RLS — and a
 * client falling back to a constant there would hardcode the number for the
 * account with the most power. `session_policy()` is SECURITY DEFINER and
 * answers for staff, tenants and the workspaceless alike.
 *
 * The two columns are also deliberately no longer part of `OrgSettings` in
 * src/platform/calendar/index.ts. Two modules able to write the same columns is
 * how they drift; auth owns sessions.
 */

export interface SessionPolicy {
  idleMinutes: number;
  absoluteHours: number;
}

/**
 * The policy used when the database cannot be asked.
 *
 * Deliberately the LOOSER of the two tiers, not the tighter one. A failed RPC —
 * offline, a bad minute, a deploy in flight — must not sign everybody out; that
 * turns an infrastructure blip into a user-facing outage, and the people it
 * would hit hardest are the ones on a phone with a weak signal.
 *
 * The absolute cap still applies, so this is a delay rather than an escape.
 */
const FALLBACK: SessionPolicy = { idleMinutes: 480, absoluteHours: 24 };

/**
 * Cached for the page load.
 *
 * The watcher ticks every fifteen seconds and must not ask the database each
 * time. A policy change takes effect on the next full load, which is the right
 * granularity for a setting an administrator edits once.
 */
let cached: SessionPolicy | null = null;

export function resetSessionPolicyCacheForTests() {
  cached = null;
}

export async function getSessionPolicy(): Promise<SessionPolicy> {
  if (cached) return cached;
  try {
    const { data, error } = await supabase.rpc("session_policy");
    if (error) return FALLBACK;
    const row = Array.isArray(data) ? data[0] : data;
    const idle = Number(row?.idle_minutes);
    const absolute = Number(row?.absolute_hours);
    // A row that arrives malformed is the same as no row. `decide()` guards
    // this too, but a NaN cached here would be re-read every tick.
    if (!Number.isFinite(idle) || idle <= 0) return FALLBACK;
    cached = {
      idleMinutes: idle,
      absoluteHours: Number.isFinite(absolute) && absolute > 0 ? absolute : FALLBACK.absoluteHours,
    };
    return cached;
  } catch {
    return FALLBACK;
  }
}

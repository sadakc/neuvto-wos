/**
 * The organisation's day and the organisation's timezone (D9).
 *
 * Reports need both, and neither may come from the browser.
 *
 * The day goes in the filename, and these files are attached to emails and kept
 * in folders. A payroll export named for the 31st when the workspace is still on
 * the 30th is a file somebody later files under the wrong month, and nothing on
 * screen ever said which day was meant.
 *
 * The timezone is what turns a `timestamptz` into a date somebody can read.
 * `submitted_at.slice(0, 10)` is the UTC day — the identical mistake the report
 * migration had to be fixed for, moved to the client.
 *
 * Elsewhere in the app the browser's date is used for presentation — a `min` on
 * a date input, sorting leave into past and upcoming — and the database decides
 * every business rule. A report is neither: it is data leaving the product.
 *
 * `today` is null while loading and if the lookup fails. Callers must treat that
 * as "not known yet" rather than substituting a date of their own, which is the
 * whole point. `timeZone` falls back to UTC, matching the database's own
 * `coalesce(s.timezone, 'UTC')`.
 */

import { useEffect, useState } from "react";
import { getCurrentUser } from "@/platform/auth";
import { getOrgSettings, getOrgToday } from "@/platform/calendar";

export interface OrgClock {
  today: string | null;
  timeZone: string;
}

export function useOrgClock(): OrgClock {
  const [clock, setClock] = useState<OrgClock>({ today: null, timeZone: "UTC" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled || !user) return;
        const [today, settings] = await Promise.all([
          getOrgToday(user.organizationId),
          getOrgSettings(),
        ]);
        if (!cancelled) setClock({ today, timeZone: settings?.timezone ?? "UTC" });
      } catch (e) {
        // Not surfaced here: the report is the screen's subject and has its own
        // error state. This disables the export button, which explains itself.
        console.error("org clock lookup failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return clock;
}

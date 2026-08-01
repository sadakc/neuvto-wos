/**
 * Who on my team is away, and when.
 *
 * The question behind every approval that is not really about the balance: two
 * people off the same week is the thing a manager is actually deciding, and the
 * approvals queue shows one request at a time.
 *
 * No new permission. `is_manager_of()` already lets a manager read their direct
 * reports' requests and profiles, and this asks for exactly that set — the same
 * definition the RLS policies use, so the screen cannot render a name the
 * database will then refuse to populate.
 *
 * Status tones come from the same semantic tokens as LeaveCalendar. Raw colour
 * values are refused in src/modules by CI, and tokens are what let an
 * organisation be themed later without touching this file (D15).
 */

import { useEffect, useMemo, useState } from "react";
import { listDirectReports } from "@/platform/auth";
import { supabase } from "@/integrations/supabase/client";
import type { LeaveStatus } from "../contracts";

interface TeamLeave {
  employeeId: string;
  fromDate: string;
  toDate: string;
  status: LeaveStatus;
  leaveTypeName: string;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TeamCalendar() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [team, setTeam] = useState<{ id: string; fullName: string | null; email: string }[]>([]);
  const [leave, setLeave] = useState<TeamLeave[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reports = await listDirectReports();
        if (cancelled) return;
        setTeam(reports);

        if (reports.length === 0) {
          setState("ready");
          return;
        }

        const { data, error } = await supabase
          .from("leave_requests")
          .select("employee_id, from_date, to_date, status, leave_types(name)")
          .in(
            "employee_id",
            reports.map((r) => r.id),
          )
          .in("status", ["approved", "pending_approval"]);

        if (error) throw error;
        if (cancelled) return;

        setLeave(
          (data ?? []).map((r) => ({
            employeeId: r.employee_id,
            fromDate: r.from_date,
            toDate: r.to_date,
            status: r.status as LeaveStatus,
            leaveTypeName: (r.leave_types as { name: string } | null)?.name ?? "Leave",
          })),
        );
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from(
      { length: count },
      (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
    );
  }, [month]);

  /** employeeId → day → the leave covering it. */
  const byPerson = useMemo(() => {
    const map = new Map<string, Map<string, TeamLeave>>();
    for (const l of leave) {
      const forPerson = map.get(l.employeeId) ?? new Map<string, TeamLeave>();
      for (
        let d = new Date(`${l.fromDate}T00:00:00`);
        d <= new Date(`${l.toDate}T00:00:00`);
        d.setDate(d.getDate() + 1)
      ) {
        forPerson.set(iso(d), l);
      }
      map.set(l.employeeId, forPerson);
    }
    return map;
  }, [leave]);

  if (state === "loading") return <div className="h-80 animate-pulse rounded-lg bg-muted" />;

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load your team&apos;s calendar. Try refreshing.
        </p>
      </div>
    );
  }

  if (team.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-lg font-semibold">Your team</h1>
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nobody reports to you yet. Once your administrator sets reporting lines, your team&apos;s
          leave shows here.
        </p>
      </div>
    );
  }

  const today = iso(new Date());

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">
          {month.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </h1>
        <div className="flex gap-2">
          <button
            aria-label="Previous month"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-border"
          >
            ‹
          </button>
          <button
            aria-label="Next month"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-border"
          >
            ›
          </button>
        </div>
      </div>

      {/* One row per person, one narrow column per day. Scrolls horizontally on a
          phone rather than reflowing — a month that wraps stops being a month. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background p-2 text-left font-medium">Person</th>
              {days.map((d) => (
                <th
                  key={iso(d)}
                  className={`w-6 p-1 text-center font-normal tabular-nums ${
                    iso(d) === today ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {d.getDate()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.map((person) => (
              <tr key={person.id} data-testid="team-row">
                <td className="sticky left-0 z-10 max-w-[10rem] truncate bg-background p-2 text-sm">
                  {person.fullName || person.email}
                </td>
                {days.map((d) => {
                  const l = byPerson.get(person.id)?.get(iso(d));
                  const tone = !l
                    ? "bg-background"
                    : l.status === "approved"
                      ? "bg-leave-approved-muted"
                      : "bg-leave-pending-muted";
                  return (
                    <td key={iso(d)} className="p-0.5">
                      <div
                        title={l ? `${l.leaveTypeName} · ${l.status.replace("_", " ")}` : undefined}
                        data-testid={l ? `team-day-${l.status}` : undefined}
                        className={`h-8 rounded-sm border border-border ${tone}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-leave-approved" /> Approved
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-leave-pending" /> Awaiting approval
        </span>
      </div>
    </div>
  );
}

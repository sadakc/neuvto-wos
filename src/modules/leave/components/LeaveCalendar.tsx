/**
 * Month calendar — PRD AC7.
 *
 * Approved and pending are distinguished by semantic tokens, never by a literal
 * blue or yellow: raw colour values are refused in `src/modules` by CI, and
 * tokens are what let an organisation be themed later without touching this
 * file (D15).
 */

import { Panel } from "@/components/shared/panel";
import { formatRange } from "@/lib/dates";
import { useEffect, useMemo, useState } from "react";
import { getMyRequests } from "../handlers";
import type { LeaveRequest } from "../contracts";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function LeaveCalendar() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    getMyRequests()
      .then((r) => {
        if (cancelled) return;
        setRequests(r);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Every day covered by a request, mapped to the request that covers it. */
  const byDay = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const r of requests) {
      if (r.status !== "approved" && r.status !== "pending_approval") continue;
      const from = new Date(`${r.fromDate}T00:00:00`);
      const to = new Date(`${r.toDate}T00:00:00`);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        map.set(iso(d), r);
      }
    }
    return map;
  }, [requests]);

  // Monday-first grid, padded so the 1st lands under the right weekday.
  const cells = useMemo(() => {
    const first = startOfMonth(month);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from(
        { length: days },
        (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
      ),
    ];
  }, [month]);

  const today = iso(new Date());
  const selectedRequest = selected ? byDay.get(selected) : undefined;

  if (state === "loading") {
    return <div className="h-80 max-w-2xl animate-pulse rounded-lg bg-muted" />;
  }

  if (state === "error") {
    return (
      <div className="max-w-md">
        <h1 className="text-page-title font-semibold tracking-page-title">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load your calendar. Try refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-page-title font-semibold tracking-page-title">Calendar</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            Your leave, month by month. Press a day to see the request.
          </p>
        </div>
        {/* Reached from here rather than from the navigation bar: it is a view of
            this calendar, and the mobile bar has room for five destinations. It
            renders for everyone — a person with no reports sees a short, honest
            "nobody reports to you yet" rather than a link that is missing for
            reasons they cannot see. */}
        <a href="/app/leave/team" className="text-sm font-medium text-primary hover:underline">
          See my team&apos;s calendar
        </a>
      </div>

      <div className="grid gap-4 @min-[900px]/app:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @min-[900px]/app:items-start">
        <Panel
          title={month.toLocaleString(undefined, { month: "long", year: "numeric" })}
          testId="panel-month"
          aside={
            <span className="flex gap-2">
              <button
                aria-label="Previous month"
                // Functional update: two quick taps must advance two months. Reading
                // `month` from the closure made the second tap reuse the first's
                // value, so rapid navigation silently lost clicks.
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="-my-1.5 inline-flex size-9 items-center justify-center rounded-md border border-border text-foreground"
              >
                ‹
              </button>
              <button
                aria-label="Next month"
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="-my-1.5 inline-flex size-9 items-center justify-center rounded-md border border-border text-foreground"
              >
                ›
              </button>
            </span>
          }
          footer={
            <span className="flex flex-wrap gap-4">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-info" /> Approved
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-warning" /> Awaiting approval
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm border border-foreground" /> Today
              </span>
            </span>
          }
        >
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`pad-${i}`} />;
              const key = iso(d);
              const req = byDay.get(key);
              const isToday = key === today;

              const tone = !req
                ? "bg-background"
                : req.status === "approved"
                  ? "bg-info-muted text-foreground"
                  : "bg-warning-muted text-foreground";

              return (
                <button
                  key={key}
                  data-testid={req ? `day-${req.status}` : "day-free"}
                  onClick={() => setSelected(req ? key : null)}
                  className={`flex h-12 items-center justify-center rounded-md border text-sm tabular-nums ${tone} ${
                    isToday ? "border-foreground font-semibold" : "border-border"
                  } ${selected === key ? "ring-2 ring-ring" : ""}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="The day you chose" testId="panel-day">
          {!selectedRequest && (
            <p className="text-sm text-muted-foreground">
              Press a coloured day to see its request.
            </p>
          )}
          {selectedRequest && (
            <div data-testid="day-detail">
              <p className="text-sm font-medium">{selectedRequest.leaveTypeName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatRange(selectedRequest.fromDate, selectedRequest.toDate)} ·{" "}
                {selectedRequest.workingDays} {selectedRequest.workingDays === 1 ? "day" : "days"} ·{" "}
                {selectedRequest.status === "approved" ? "Approved" : "Awaiting approval"}
              </p>
              {selectedRequest.reason && (
                <p className="mt-2 text-sm text-muted-foreground">{selectedRequest.reason}</p>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

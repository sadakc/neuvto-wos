/**
 * A Leave report over a window of dates (D94): the organisation's month by
 * default, From and To to change it, a backwards window caught before it is
 * sent. The leave-taken report's arrangement, shared by the reports that
 * followed it.
 */

import { useEffect, useState } from "react";
import { ReportView, monthBounds, useOrgClock, type ReportColumn } from "@/platform/reports";
import { isAppError } from "@/platform/errors";

export function WindowedReport<T>({
  slug,
  title,
  columns,
  fetch,
  rowKey,
  empty,
  note,
}: {
  slug: string;
  title: string;
  columns: (timeZone: string) => ReportColumn<T>[];
  fetch: (from: string, to: string) => Promise<T[]>;
  rowKey: (row: T) => string;
  empty: string;
  /** A sentence under the filters, when the numbers need one. */
  note?: string;
}) {
  const { today, timeZone } = useOrgClock();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (today && !range) setRange(monthBounds(today));
  }, [today, range]);

  const invalid = range !== null && range.to < range.from;

  useEffect(() => {
    if (!range || invalid) return;
    let cancelled = false;
    setState("loading");
    fetch(range.from, range.to)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setError("");
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load this report.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
    // `fetch` is a module-level handler; the window is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, invalid]);

  return (
    <div>
      {note && <p className="mb-3 text-xs text-muted-foreground">{note}</p>}
      <ReportView
        slug={slug}
        title={title}
        columns={columns(timeZone)}
        rows={invalid ? [] : rows}
        rowKey={rowKey}
        state={invalid ? "ready" : state}
        error={invalid ? "The end date is before the start date." : error}
        today={today}
        empty={invalid ? "Fix the dates to run this report." : empty}
        filters={
          <>
            {(["from", "to"] as const).map((k) => (
              <label key={k} className="text-xs text-muted-foreground">
                {k === "from" ? "From" : "To"}
                <input
                  type="date"
                  value={range?.[k] ?? ""}
                  disabled={!range}
                  onChange={(e) => setRange((r) => (r ? { ...r, [k]: e.target.value } : r))}
                  className="mt-1 block h-12 w-full rounded-md border border-border bg-background px-3 text-sm @min-[640px]/app:w-44"
                />
              </label>
            ))}
          </>
        }
      />
    </div>
  );
}

/**
 * Every payroll report answers a question about ONE month, so every one of them
 * needs the same two things: a run to look at, and its lines.
 *
 * Written once because six reports need it, and because the alternative —
 * each report fetching its own runs — is six chances for the month selector to
 * behave differently on the screen that produces the bank file than on the one
 * that produces the PF return.
 *
 * THE DEFAULT IS THE MOST RECENT RUN, not the current month. A month with no
 * run yet is an empty report that reads as a fault; the newest run is the one
 * somebody is almost always asking about.
 */

import { useEffect, useState } from "react";
import { useOrgClock } from "@/platform/reports";
import { isAppError } from "@/platform/errors";
import { getRunLines, listRuns } from "../handlers";
import type { PayRunSummary, PayslipLine } from "../contracts";

export interface PayRunReport {
  runs: PayRunSummary[];
  runId: string;
  setRunId: (id: string) => void;
  lines: PayslipLine[];
  state: "loading" | "ready" | "error";
  error: string;
  /**
   * The organisation's own day (D9). Fetched here rather than in each report so
   * six exports of the same month cannot end up with two different dates in
   * their filenames.
   */
  today: string | null;
}

export function usePayRunReport(): PayRunReport {
  const [runs, setRuns] = useState<PayRunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [lines, setLines] = useState<PayslipLine[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const { today } = useOrgClock();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listRuns();
        if (cancelled) return;
        setRuns(list);
        setRunId(list[0]?.id ?? "");
        // No runs at all is ready-and-empty, not an error. A workspace that has
        // never run payroll is the ordinary starting state.
        if (list.length === 0) setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load your pay runs.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const data = await getRunLines(runId);
        if (cancelled) return;
        setLines(data);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(isAppError(e) ? e.message : "We couldn't load this pay run.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return { runs, runId, setRunId, lines, state, error, today };
}

/** "July 2026" — the label a payroll administrator uses for the run. */
export function monthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

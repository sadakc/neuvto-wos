/**
 * One leave request, as the person deciding it sees it.
 *
 * Rendered by the platform's approvals queue, which handed us a row it knows
 * nothing about beyond `entity_type = 'leave_request'`. Everything below —
 * balances, leave types, working days — is this module's vocabulary and stays
 * inside this folder.
 *
 * The balance shown is for the **requested type only**, decided with Sada. See
 * `getApprovalDetail`: deciding on three days of Casual is a question the Casual
 * row answers, and is not a reason to disclose somebody's sick-leave
 * consumption to an approver two levels up who is not otherwise entitled to it.
 */

import { useEffect, useState } from "react";
import type { ModuleApprovalViewProps } from "@/platform/modules";
import { rejectReasonLabel } from "@/platform/approvals";
import { getApprovalDetail, getApprovalTimeline } from "../handlers";
import { DecisionControls } from "./DecisionControls";
import type { ApprovalStep, LeaveApprovalDetail } from "../contracts";

function formatRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  if (from === to) return f.toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `${f.toLocaleDateString(undefined, opts)} – ${t.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
}

export default function LeaveApprovalCard({ item, onDecided }: ModuleApprovalViewProps) {
  const [detail, setDetail] = useState<LeaveApprovalDetail | null>(null);
  const [timeline, setTimeline] = useState<ApprovalStep[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getApprovalDetail(item.approvalRequestId)
      .then((d) => !cancelled && setDetail(d))
      // The row still renders without this. A queue entry that disappears
      // because one fetch failed is a decision nobody knows they owe.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [item.approvalRequestId]);

  useEffect(() => {
    if (!expanded || timeline.length > 0) return;
    let cancelled = false;
    getApprovalTimeline(item.approvalRequestId)
      .then((t) => !cancelled && setTimeline(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, item.approvalRequestId, timeline.length]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load the details of this leave request. It is still waiting on you — try
        refreshing.
      </p>
    );
  }

  if (!detail) return <div className="h-20 animate-pulse rounded bg-muted" />;

  const remaining =
    detail.availableDays === null ? null : detail.availableDays - detail.workingDays;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{detail.leaveTypeName}</span>
        <span className="text-sm text-muted-foreground">
          {formatRange(detail.fromDate, detail.toDate)}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          · {detail.workingDays} working {detail.workingDays === 1 ? "day" : "days"}
        </span>
      </div>

      {/* The number the decision actually turns on. */}
      <p className="mt-2 text-sm tabular-nums">
        {detail.availableDays === null ? (
          <span className="text-muted-foreground">
            No balance is set up for this leave year yet
          </span>
        ) : (
          <>
            <span className="font-medium">{detail.availableDays}</span>
            <span className="text-muted-foreground">
              {" "}
              available{detail.entitledDays !== null && ` of ${detail.entitledDays}`}
              {remaining !== null && ` · ${remaining} left if you approve`}
            </span>
          </>
        )}
      </p>

      {detail.reason && (
        <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">
          “{detail.reason}”
        </p>
      )}

      <button
        onClick={() => setExpanded((x) => !x)}
        className="mt-3 text-sm text-muted-foreground underline underline-offset-4"
      >
        {expanded ? "Hide history" : "Approval history"}
      </button>

      {expanded && (
        <ol className="mt-3 space-y-2 border-l border-border pl-4">
          {timeline.length === 0 ? (
            <li className="text-xs text-muted-foreground">Loading…</li>
          ) : (
            timeline.map((s) => (
              <li key={s.level} className="text-xs">
                <span className="font-medium">Level {s.level}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {s.approverName} ·{" "}
                  {s.decision === "pending"
                    ? "waiting"
                    : `${s.decision}${s.decidedAt ? ` ${new Date(s.decidedAt).toLocaleDateString()}` : ""}`}
                </span>
                {s.escalatedFrom && (
                  <span className="mt-0.5 block text-muted-foreground">
                    moved up from {s.escalatedFrom}
                    {s.escalatedAt ? ` ${new Date(s.escalatedAt).toLocaleDateString()}` : ""}
                  </span>
                )}
                {rejectReasonLabel(s.reasonCode) && (
                  <span className="mt-0.5 block font-medium">
                    {rejectReasonLabel(s.reasonCode)}
                  </span>
                )}
                {s.comments && (
                  <span className="mt-0.5 block text-muted-foreground">“{s.comments}”</span>
                )}
              </li>
            ))
          )}
        </ol>
      )}

      <DecisionControls item={item} onDecided={onDecided} />
    </div>
  );
}

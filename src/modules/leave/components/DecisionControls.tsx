/**
 * Approve, or reject with a reason and a note (Leave phase 2), for any of
 * Leave's approvals: a leave request, a compensatory off claim. The rules are
 * the engine's (approval_decide); this only asks for what they need.
 */

import { useState } from "react";
import type { ModuleApprovalViewProps } from "@/platform/modules";
import { decideApproval, REJECT_REASONS, type RejectReason } from "@/platform/approvals";
import { isAppError } from "@/platform/errors";

export function DecisionControls({ item, onDecided }: ModuleApprovalViewProps) {
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function decide(decision: "approved" | "rejected") {
    setError("");
    setBusy(decision);
    try {
      if (decision === "rejected") {
        await decideApproval(item.approvalRequestId, "rejected", note, reasonCode || undefined);
      } else {
        await decideApproval(item.approvalRequestId, "approved", comments, undefined);
      }
      onDecided();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That decision couldn't be recorded.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {!rejecting ? (
        <>
          <div className="mt-4">
            <label htmlFor={`c-${item.approvalRequestId}`} className="sr-only">
              Comment
            </label>
            <input
              id={`c-${item.approvalRequestId}`}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Add a comment (optional)"
              className="h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          {error && (
            <p role="alert" data-testid="decide-error" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide("approved")}
              disabled={busy !== null}
              data-testid="approve"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === "approved" ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={() => {
                setError("");
                setRejecting(true);
              }}
              disabled={busy !== null}
              data-testid="reject"
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </>
      ) : (
        <div
          data-testid="reject-panel"
          className="mt-4 space-y-3 rounded-md border border-border bg-muted/40 p-3"
        >
          <div>
            <label htmlFor={`r-${item.approvalRequestId}`} className="block text-sm font-medium">
              Why are you rejecting this?
            </label>
            <select
              id={`r-${item.approvalRequestId}`}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as RejectReason | "")}
              data-testid="reject-reason"
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Choose a reason…</option>
              {REJECT_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`n-${item.approvalRequestId}`} className="block text-sm font-medium">
              A note for {item.requesterName}
            </label>
            <textarea
              id={`n-${item.approvalRequestId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              data-testid="reject-note"
              placeholder="They read this with the reason."
              className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm"
            />
          </div>

          {error && (
            <p role="alert" data-testid="decide-error" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => decide("rejected")}
              disabled={busy !== null || !reasonCode || note.trim().length < 3}
              data-testid="confirm-reject"
              className="inline-flex h-12 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              {busy === "rejected" ? "Rejecting…" : "Reject request"}
            </button>
            <button
              onClick={() => setRejecting(false)}
              disabled={busy !== null}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </>
  );
}

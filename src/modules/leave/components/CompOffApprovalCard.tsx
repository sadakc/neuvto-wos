/**
 * One compensatory off claim, as the person deciding it sees it (D89).
 *
 * Rendered by the platform's approvals queue for entity_type 'comp_off_claim'.
 * Every day claimed, the reason in the person's words, and the proof if there
 * is any, opened through a link that lasts five minutes and that storage only
 * hands to the person, their approver and the Leave Admin.
 */

import { useEffect, useState } from "react";
import type { ModuleApprovalViewProps } from "@/platform/modules";
import { getCompOffApprovalDetail, getProofUrl } from "../handlers";
import type { CompOffApprovalDetail } from "../contracts";
import { DecisionControls } from "./DecisionControls";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export default function CompOffApprovalCard({ item, onDecided }: ModuleApprovalViewProps) {
  const [detail, setDetail] = useState<CompOffApprovalDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [proofError, setProofError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getCompOffApprovalDetail(item.approvalRequestId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [item.approvalRequestId]);

  async function openProof(path: string) {
    setProofError("");
    try {
      window.open(await getProofUrl(path), "_blank", "noopener");
    } catch {
      setProofError("The proof couldn't be opened. Try again.");
    }
  }

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this claim. It is still waiting on you — try refreshing.
      </p>
    );
  }
  if (!detail) return <div className="h-20 animate-pulse rounded bg-muted" />;

  return (
    <div data-testid="comp-off-approval">
      <p className="text-sm font-medium">
        {detail.leaveTypeName} · {plural(detail.totalDays)} claimed
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {detail.days.map((d) => (
          <li key={d.date}>
            {longDate(d.date)} · {d.days === 1 ? "full day" : "half day"}
            {d.note ? ` · ${d.note}` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">
        “{detail.reason}”
      </p>
      {detail.proofPath ? (
        <button
          type="button"
          onClick={() => void openProof(detail.proofPath!)}
          className="mt-2 text-sm font-medium underline underline-offset-4"
        >
          Open the proof
        </button>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No proof attached.</p>
      )}
      {proofError && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {proofError}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Approving credits {plural(detail.totalDays)} to their {detail.leaveTypeName}.
      </p>
      <DecisionControls item={item} onDecided={onDecided} />
    </div>
  );
}

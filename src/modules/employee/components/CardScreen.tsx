/**
 * Loads a card and renders it, with the three answers a load can give: the
 * card, "not in your company" (NOT_FOUND, which is also what an id from
 * another company gets), or a failure worth retrying.
 */

import { useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import type { EmployeeCard } from "../contracts";
import { getEmployeeCard } from "../handlers";
import { EmployeeCardView } from "./EmployeeCardView";

export function CardScreen({ employeeId }: { employeeId?: string }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; card: EmployeeCard } | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getEmployeeCard(employeeId)
      .then((card) => !cancelled && setState({ kind: "ready", card }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setState({
            kind: "error",
            message: isAppError(e) ? e.message : "That didn't load. Please try again.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-36 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <p
        role="alert"
        data-testid="card-error"
        className="max-w-prose rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
      >
        {state.message}
      </p>
    );
  }
  // Keyed, so moving from one person to another starts on Overview rather than
  // carrying a sub-tab across that the next person's card may not have.
  return <EmployeeCardView key={state.card.id} card={state.card} />;
}

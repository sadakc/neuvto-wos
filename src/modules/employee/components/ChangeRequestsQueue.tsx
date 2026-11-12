/**
 * Change requests waiting, on Home's Approvals (D111): what people have asked
 * to be corrected on their own record, for the Employee Admins to make or
 * decline. The same rows as Employee Card › Change requests, which keeps the
 * history.
 */

import { useCallback, useEffect, useState } from "react";
import { isAppError } from "@/platform/errors";
import { ModuleLink } from "@/platform/modules";
import type { ChangeRequest } from "../contracts";
import { listChangeRequests } from "../handlers";
import { ChangeRequestRow } from "./ChangeRequests";

export default function ChangeRequestsQueue() {
  const [rows, setRows] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listChangeRequests("open")
      .then(setRows)
      .catch((e: unknown) => {
        setRows([]);
        setError(isAppError(e) ? e.message : "Change requests didn't load.");
      });
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-3" data-testid="change-requests-queue">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows === null ? (
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      ) : rows.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">
          Nobody has asked for a change.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <ChangeRequestRow key={r.id} request={r} onResolved={load} />
          ))}
        </ul>
      )}
      <ModuleLink
        path="employee/change-requests"
        className="self-start text-sm font-medium text-primary hover:underline"
      >
        Every change request, made and declined too
      </ModuleLink>
    </div>
  );
}

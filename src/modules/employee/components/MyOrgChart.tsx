/**
 * Your own line, on the Employee Card (Sada, 14 Oct 2026): from the top of
 * the company down to you, then the people who report to you. Not your peers
 * and not the rest of the company; the whole chart is under Organisation.
 */

import { useEffect, useState } from "react";
import { getUserId } from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import type { OrgChartNode } from "../contracts";
import { getOrgChart } from "../handlers";
import { Panel } from "./parts";
import { PersonLink } from "./PersonLink";

/** You and everybody above you, the top first. A loop in the data stops it. */
function lineAbove(nodes: OrgChartNode[], me: string): OrgChartNode[] {
  const byId = new Map(nodes.map((n) => [n.profileId, n]));
  const line: OrgChartNode[] = [];
  const seen = new Set<string>();
  for (let n = byId.get(me); n && !seen.has(n.profileId); ) {
    line.unshift(n);
    seen.add(n.profileId);
    n = n.managerProfileId ? byId.get(n.managerProfileId) : undefined;
  }
  return line;
}

function Person({ n, you }: { n: OrgChartNode; you?: boolean }) {
  return (
    <div
      className={
        "inline-flex min-w-[14rem] flex-col rounded-lg border px-3 py-2 " +
        (you ? "border-primary bg-accent" : "border-border bg-card")
      }
    >
      <span className="flex items-center gap-2">
        <PersonLink employeeId={n.id} className="text-sm font-medium">
          {n.fullName ?? "Unnamed"}
        </PersonLink>
        {you && <span className="text-caption font-semibold text-primary">You</span>}
      </span>
      <span className="text-caption text-muted-foreground">
        {n.designation ?? "No designation"}
      </span>
    </div>
  );
}

export default function MyOrgChart() {
  const [nodes, setNodes] = useState<OrgChartNode[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getOrgChart(), getUserId().catch(() => null)])
      .then(([n, uid]) => {
        if (cancelled) return;
        setNodes(n);
        setMe(uid);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(isAppError(e) ? e.message : "The org chart didn't load.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const line = nodes && me ? lineAbove(nodes, me) : [];
  const team = (nodes ?? [])
    .filter((n) => me && n.managerProfileId === me)
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Org Chart</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Who you report to, all the way to the top, and who reports to you. The whole company is
          under Organisation.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {nodes === null && !error ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : nodes && line.length === 0 ? (
        !error && (
          <p className="text-sm text-muted-foreground">
            You are not on the org chart yet: it draws people once they have signed in.
          </p>
        )
      ) : (
        nodes && (
          <Panel title="Your reporting line" testId="my-org-chart">
            <div className="overflow-x-auto">
              <ol>
                {line.map((n, i) => (
                  <li
                    key={n.profileId}
                    data-testid="line-node"
                    style={{ marginLeft: `${i * 1.25}rem` }}
                    className={i > 0 ? "border-l border-border py-1.5 pl-4" : "py-1.5"}
                  >
                    <span data-testid={n.profileId === me ? "line-you" : undefined}>
                      <Person n={n} you={n.profileId === me} />
                    </span>
                  </li>
                ))}
              </ol>
              <div style={{ marginLeft: `${line.length * 1.25}rem` }} className="pl-4">
                {team.length === 0 ? (
                  <p className="py-1.5 text-sm text-muted-foreground">Nobody reports to you.</p>
                ) : (
                  <ul className="border-l border-border pl-4">
                    {team.map((n) => (
                      <li key={n.profileId} data-testid="line-report" className="py-1.5">
                        <Person n={n} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Panel>
        )
      )}
    </div>
  );
}

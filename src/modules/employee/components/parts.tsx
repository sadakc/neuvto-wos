/**
 * The Employee Master's building blocks: a card panel, a label/value grid and
 * the read-only table every history uses. Local to the module until a second
 * module needs them; then they move to the platform, not sideways.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  aside,
  footer,
  children,
  className,
  testId,
}: {
  title: string;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn("min-w-0 rounded-xl border border-border bg-card shadow-card", className)}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-card-title font-semibold tracking-card-title">{title}</h3>
        {aside && <div className="ml-auto text-caption text-muted-foreground">{aside}</div>}
      </div>
      <div className="px-4 py-3.5">{children}</div>
      {footer && (
        <p className="border-t border-border px-4 py-3 text-caption text-muted-foreground">
          {footer}
        </p>
      )}
    </section>
  );
}

/** One label and its value. A missing value reads as a dash, never as blank space. */
export interface FieldItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function Fields({ items, columns = 2 }: { items: FieldItem[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 3 && "@min-[640px]/app:grid-cols-3",
        columns >= 2 && "@min-[480px]/app:grid-cols-2",
      )}
    >
      {items.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
            {f.label}
          </dt>
          <dd className={cn("mt-0.5 text-sm break-words", f.mono && "font-mono")}>
            {f.value === null || f.value === undefined || f.value === "" ? "—" : f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A read-only table that scrolls inside itself, never the page (§8.9). A row
 * marked `muted` is history: greyed, and it carries no controls at all.
 */
export function RecordTable({
  headers,
  rows,
  empty,
  testId,
}: {
  headers: string[];
  rows: { key: string; cells: ReactNode[]; muted?: boolean }[];
  empty: string;
  testId?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4" data-testid={testId}>
      <table className="w-full min-w-[36rem] border-collapse text-table-cell">
        <thead>
          <tr className="border-b border-border text-left">
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="py-2 pr-4 text-table-header font-semibold tracking-table-header whitespace-nowrap text-muted-foreground uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              data-muted={r.muted ? "true" : undefined}
              className={cn(
                "border-b border-border last:border-0",
                r.muted && "text-muted-foreground",
              )}
            >
              {r.cells.map((c, i) => (
                <td key={i} className="py-2 pr-4 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

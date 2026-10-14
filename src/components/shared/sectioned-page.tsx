/**
 * A page of numbered sections, two panes (Core HR design, as the Employee
 * Card's Configuration): the list beside the content on a wide screen, above
 * it on a narrow one, and one section shown at a time in its own panel.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Panel } from "./panel";

export interface PageSection {
  id: string;
  label: string;
  /** A line under the section's title. */
  description?: ReactNode;
  content: ReactNode;
}

export function SectionedPage({
  title,
  description,
  sections,
  testIdPrefix,
  empty,
}: {
  title: string;
  description?: ReactNode;
  sections: PageSection[];
  /** Each section's button is `${testIdPrefix}-${id}`. */
  testIdPrefix: string;
  /** What to say when there is no section at all. */
  empty?: ReactNode;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const current = sections.find((s) => s.id === chosen) ?? sections[0];
  const number = (i: number) => String(i + 1).padStart(2, "0");

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-16">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">{title}</h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-foreground-secondary">{description}</p>
        )}
      </div>
      {!current ? (
        empty && <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid gap-4 @min-[1000px]/app:grid-cols-[15rem_1fr]">
          <nav aria-label={`${title} sections`} className="min-w-0">
            <ul className="flex gap-1 overflow-x-auto @min-[1000px]/app:flex-col">
              {sections.map((s, i) => (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={current.id === s.id ? "page" : undefined}
                    data-testid={`${testIdPrefix}-${s.id}`}
                    onClick={() => setChosen(s.id)}
                    className={cn(
                      "h-11 w-full rounded-md px-3 text-left text-sm whitespace-nowrap",
                      current.id === s.id
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-foreground-secondary hover:bg-muted",
                    )}
                  >
                    {number(i)} {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0">
            <Panel title={current.label} testId={`${testIdPrefix}-panel`}>
              {current.description && (
                <p className="mb-4 max-w-prose text-sm text-muted-foreground">
                  {current.description}
                </p>
              )}
              {current.content}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

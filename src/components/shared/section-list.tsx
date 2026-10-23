/**
 * The index of a level on a phone (doc 11.4, 11.6): one row per section, its
 * label, a one-line hint and a chevron or a count. Everything at that level is
 * on one screen, with nothing to scroll sideways.
 */

import { ChevronRight } from "lucide-react";

export interface SectionListItem {
  id: string;
  label: string;
  hint?: string;
  badge?: number;
}

export function SectionList({
  items,
  onSelect,
  label,
  testIdPrefix = "section",
}: {
  items: SectionListItem[];
  onSelect: (id: string) => void;
  /** The list's accessible name ("Priya Employee's record"). */
  label: string;
  testIdPrefix?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
        {items.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              data-testid={`${testIdPrefix}-${s.id}`}
              onClick={() => onSelect(s.id)}
              className="flex min-h-[58px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{s.label}</span>
                {s.hint && (
                  <span className="mt-0.5 block text-caption text-muted-foreground">{s.hint}</span>
                )}
              </span>
              {s.badge ? (
                <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-caption font-semibold text-destructive-foreground">
                  {s.badge}
                </span>
              ) : (
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

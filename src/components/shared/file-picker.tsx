/**
 * Choosing a file (D104). The browser's own file input renders as a line of
 * bold text once the stylesheet's reset has taken its button away, which reads
 * as nothing to click. This is a Browse button, the chosen file's name and
 * size, and Remove to unchoose it before anything is uploaded.
 */

import { useId, useRef } from "react";
import { Paperclip, X } from "lucide-react";

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function FilePicker({
  file,
  onChange,
  label,
  accept = "application/pdf,image/png,image/jpeg,image/webp",
  hint,
  testId,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  label: string;
  accept?: string;
  hint?: string;
  testId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  return (
    <div className="min-w-0 text-sm" data-testid={testId}>
      <span className="block font-medium">{label}</span>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-describedby={hint ? hintId : undefined}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-4 font-medium hover:bg-muted"
        >
          <Paperclip className="size-4" aria-hidden />
          {file ? "Choose another" : "Browse…"}
        </button>
        {file ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
            <span className="truncate" data-testid={testId ? `${testId}-name` : undefined}>
              {file.name}
            </span>
            <span className="shrink-0 text-caption text-muted-foreground">{size(file.size)}</span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                if (input.current) input.current.value = "";
              }}
              aria-label={`Remove ${file.name}`}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        ) : (
          <span className="text-muted-foreground">No file chosen</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        aria-label={label}
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {hint && (
        <span id={hintId} className="mt-1 block text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser, isAdmin, type CurrentUser } from "@/platform/auth";
import {
  dryRun,
  parseImportFile,
  runImport,
  OPTIONAL_COLUMNS,
  REQUIRED_COLUMNS,
  type ImportRow,
  type RowResult,
} from "@/platform/auth/import";

export const Route = createFileRoute("/app/import")({
  ssr: false,
  head: () => ({ meta: [{ title: "Import people — Neuvto WOS" }] }),
  component: ImportPage,
});

/**
 * Bringing an existing workforce in from a spreadsheet.
 *
 * What this screen is careful to say, because it is the thing customers get
 * wrong: **this invites people, it does not create them.** Nobody appears in the
 * workspace until they follow their link and confirm their address (D39). The
 * file's start dates and reporting lines are held on the invitations and
 * applied as each person arrives.
 *
 * Nothing is sent until the second click. The first one only reads.
 */
function ImportPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [preview, setPreview] = useState<RowResult[] | null>(null);
  const [done, setDone] = useState<RowResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await getCurrentUser().catch(() => null);
      if (cancelled) return;
      setUser(u);
      if (!isAdmin(u)) {
        setState("denied");
        return;
      }
      const { data } = await supabase.from("departments").select("id, name").order("name");
      if (!cancelled) {
        setDepartments(data ?? []);
        setState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setDone(null);
    setPreview(null);
    setFileName(file.name);

    const parsed = parseImportFile(await file.text());
    setMissing(parsed.missingColumns);
    setRows(parsed.rows);

    if (parsed.missingColumns.length === 0 && parsed.rows.length > 0) {
      setBusy(true);
      try {
        setPreview(
          await dryRun(
            parsed.rows,
            departments.map((d) => d.name),
          ),
        );
      } catch {
        setError("We couldn't check that file against this workspace. Try again.");
      } finally {
        setBusy(false);
      }
    }
  }

  async function onImport() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      // Only the rows the dry run said could go. The failures are reported
      // again in the result so the person sees one complete list, not two.
      const sendable = preview.filter((r) => r.outcome !== "error").map((r) => r.row);
      const results = await runImport(
        sendable,
        new Map(departments.map((d) => [d.name.toLowerCase(), d.id])),
      );
      setDone([...results, ...preview.filter((r) => r.outcome === "error")]);
      setPreview(null);
    } catch {
      setError("Something went wrong part-way through. The report below shows what was sent.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your administrator manages who is in this workspace.
        </p>
      </div>
    );
  }

  const results = done ?? preview;
  const sendable = preview?.filter((r) => r.outcome !== "error").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="font-display text-xl font-semibold tracking-tight">Import people</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        A spreadsheet of your existing staff. This <strong>invites</strong> them — each person
        follows a link and confirms their own address before they appear in{" "}
        {user?.organizationName ?? "this workspace"}. Their start dates and reporting lines are
        applied as they arrive.
      </p>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="font-display text-base font-semibold">The file</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A CSV whose first row is the column names. Required:{" "}
          <span className="text-foreground">{REQUIRED_COLUMNS.join(", ")}</span>. Optional:{" "}
          {OPTIONAL_COLUMNS.join(", ")}.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          <strong>Start dates matter more than they look.</strong> Leave for the year is worked out
          from them, so somebody recorded as starting today gets a fraction of what they are owed.
          Use the date they actually joined the company.
        </p>

        <label className="mt-4 inline-flex min-h-12 cursor-pointer items-center rounded-md border border-border px-4 py-2 text-sm font-medium">
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
          Choose a CSV
        </label>
        {fileName && <span className="ml-3 text-sm text-muted-foreground">{fileName}</span>}
      </section>

      {missing.length > 0 && (
        <p role="alert" data-testid="import-missing" className="mt-4 text-sm text-destructive">
          That file has no {missing.join(", ")} column
          {missing.length > 1 ? "s" : ""}. Nothing can be imported without{" "}
          {missing.length > 1 ? "them" : "it"}.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="import-error" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {results && (
        <section className="mt-8">
          <h2 className="font-display text-base font-semibold">
            {done ? "What happened" : `${rows.length} rows read`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {done
              ? `${done.filter((r) => r.outcome === "imported").length} invited, ` +
                `${done.filter((r) => r.outcome !== "imported").length} not sent.`
              : `${sendable} will be invited, ` +
                `${results.filter((r) => r.outcome === "error").length} cannot be.`}
          </p>

          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {results.map((r) => (
              <li key={r.row.line} data-testid="import-row" className="flex gap-3 p-3 text-sm">
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                  {r.row.line}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {r.row.fullName || "(no name)"}{" "}
                    <span className="text-muted-foreground">{r.row.email}</span>
                  </span>
                  {r.message && (
                    <span
                      className={`block text-xs ${
                        r.outcome === "error" || r.outcome === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {r.message}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {
                    {
                      "will-import": "ready",
                      warning: "ready, with a gap",
                      error: "cannot import",
                      imported: "invited",
                      failed: "not sent",
                    }[r.outcome]
                  }
                </span>
              </li>
            ))}
          </ul>

          {preview && sendable > 0 && (
            <div className="mt-4">
              <button
                onClick={onImport}
                disabled={busy}
                data-testid="confirm-import"
                className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Inviting…" : `Invite ${sendable} ${sendable === 1 ? "person" : "people"}`}
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                This sends {sendable} {sendable === 1 ? "email" : "emails"}, now. Nothing has been
                sent yet.
              </p>
            </div>
          )}

          {done && (
            <p className="mt-4 text-sm text-muted-foreground">
              Rows that were not sent changed nothing — fix them in the file and import it again.
              Only the addresses that failed will be new.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

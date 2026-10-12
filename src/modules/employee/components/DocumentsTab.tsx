/**
 * The card's Documents tab (D95): the twelve documents a record holds.
 *
 * Seen by the person and the Employee Admin only; the database refuses anybody
 * else, and the card shows the tab only to them. Both upload. Only the
 * Employee Admin verifies (never on their own record) and removes, with a
 * reason; nothing is ever deleted, and a new file for the same document
 * replaces the old one, which stays in the record.
 *
 * Opening a document is logged first and only then signed (openDocument), so
 * the person and the Admin can each be told, truthfully, that every opening is
 * on record.
 */

import { useEffect, useState } from "react";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { isAppError } from "@/platform/errors";
import {
  listDocuments,
  listDocumentViews,
  openDocument,
  removeDocument,
  uploadDocument,
  verifyDocument,
} from "../handlers";
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type DocumentView,
  type EmployeeDocument,
} from "../contracts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08-02" or a timestamp → "2 Aug 2026", read as the date written, no time zone. */
const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const STATUS: Record<EmployeeDocument["status"] | "missing", { label: string; tone: StatusTone }> =
  {
    verified: { label: "Verified", tone: "success" },
    uploaded: { label: "Uploaded", tone: "info" },
    expired: { label: "Expired", tone: "destructive" },
    missing: { label: "Not submitted", tone: "warning" },
  };

type Row = { type: (typeof DOCUMENT_TYPES)[number]; doc: EmployeeDocument | null };

export function DocumentsTab({
  employeeId,
  isAdmin,
  isSelf,
}: {
  employeeId: string;
  /** The Employee Admin (D85): verifies and removes. */
  isAdmin: boolean;
  /** The caller's own record: nobody verifies their own papers. */
  isSelf: boolean;
}) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [views, setViews] = useState<DocumentView[] | null>(null);

  async function load() {
    setDocs(await listDocuments(employeeId));
  }

  useEffect(() => {
    let cancelled = false;
    listDocuments(employeeId)
      .then((d) => {
        if (cancelled) return;
        setDocs(d);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setError("");
    setBusy(true);
    try {
      await fn();
      after?.();
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function view(id: string) {
    setError("");
    try {
      window.open(await openDocument(id), "_blank", "noopener");
    } catch (err) {
      setError(isAppError(err) ? err.message : "That document couldn't be opened.");
    }
  }

  function startUpload(type: DocumentType) {
    setUploading(type);
    setTitle("");
    setExpiresOn("");
    setFile(null);
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load the documents just now. Try refreshing.
      </p>
    );
  }

  // Every type once; a named type (relieving letters) once per document on file.
  const rows: Row[] = DOCUMENT_TYPES.flatMap<Row>((type) => {
    const onFile = docs.filter((d) => d.docType === type.key);
    return onFile.length ? onFile.map((doc) => ({ type, doc })) : [{ type, doc: null }];
  });
  const kind = uploading ? DOCUMENT_TYPES.find((t) => t.key === uploading) : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {docs.length} on file, {rows.filter((r) => !r.doc).length} not submitted.
        </p>
        <button
          type="button"
          onClick={() => startUpload("offer_letter")}
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Upload a document
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {uploading && kind && (
        <form
          className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-card @min-[640px]/app:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            void run(
              () =>
                uploadDocument({
                  employeeId,
                  docType: uploading,
                  title: "named" in kind ? title.trim() : "",
                  expiresOn: expiresOn || null,
                  file,
                }),
              () => setUploading(null),
            );
          }}
        >
          <label className="text-sm font-medium">
            Document
            <select
              value={uploading}
              onChange={(e) => setUploading(e.target.value as DocumentType)}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {"named" in kind && (
            <label className="text-sm font-medium">
              {kind.key === "relieving_letter" ? "Which employer" : "What it is"}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </label>
          )}
          <label className="text-sm font-medium">
            Expires on (optional)
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="text-sm font-medium">
            File
            <input
              type="file"
              aria-label="File"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              PDF or a photo, up to 10 MB. A new file for a document already on file replaces it;
              the old one stays in the record.
            </span>
          </label>
          <div className="flex gap-2 @min-[640px]/app:col-span-2">
            <button
              type="submit"
              disabled={busy || !file}
              className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              {busy ? "Uploading…" : "Upload"}
            </button>
            <button
              type="button"
              onClick={() => setUploading(null)}
              className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-card">
        {rows.map(({ type, doc }) => {
          const name = doc?.title ? `${type.label}, ${doc.title}` : type.label;
          const status = STATUS[doc?.status ?? "missing"];
          return (
            <li
              key={doc?.id ?? type.key}
              data-testid="document-row"
              className="flex flex-col gap-2 p-4 @min-[640px]/app:flex-row @min-[640px]/app:items-center @min-[640px]/app:justify-between"
            >
              <div className="min-w-0">
                <span className="block text-sm font-medium">{name}</span>
                <span className="block text-xs text-muted-foreground">
                  {doc
                    ? `${type.category} · uploaded ${day(doc.uploadedAt)}${
                        doc.expiresOn ? ` · expires ${day(doc.expiresOn)}` : ""
                      }${doc.verifiedBy ? ` · Verified by ${doc.verifiedBy}` : ""}`
                    : type.category}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                {doc ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void view(doc.id)}
                      className="text-sm underline underline-offset-4"
                    >
                      View
                    </button>
                    {isAdmin && !isSelf && doc.status === "uploaded" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => verifyDocument(doc.id))}
                        className="text-sm underline underline-offset-4"
                      >
                        Verify
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setRemoving(doc.id);
                          setReason("");
                        }}
                        className="text-sm underline underline-offset-4"
                      >
                        Remove
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`Upload ${name}`}
                    onClick={() => startUpload(type.key)}
                    className="text-sm underline underline-offset-4"
                  >
                    Upload
                  </button>
                )}
              </div>
              {removing === doc?.id && doc && (
                <form
                  className="flex w-full flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      () => removeDocument(doc.id, reason.trim()),
                      () => setRemoving(null),
                    );
                  }}
                >
                  <label className="flex-1 text-xs text-muted-foreground">
                    Why is it being removed?
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={200}
                      className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || reason.trim().length < 3}
                    className="inline-flex h-11 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground disabled:opacity-45"
                  >
                    Remove the document
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(null)}
                    className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm"
                  >
                    Keep it
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Every time a document is opened, it is logged against the name of whoever opened it. Only
        you and the Employee Admin can see or open these. Removed and replaced documents stay in the
        record.
      </p>

      {isAdmin && (
        <div>
          <button
            type="button"
            onClick={() =>
              views
                ? setViews(null)
                : void listDocumentViews(employeeId)
                    .then(setViews)
                    .catch(() => setError("We couldn't load who opened these."))
            }
            className="text-sm underline underline-offset-4"
          >
            {views ? "Hide who opened these" : "Who has opened these"}
          </button>
          {views && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {views.length === 0 && <li>Nobody has opened them yet.</li>}
              {views.map((v, i) => (
                <li key={i}>
                  {v.viewerName} opened{" "}
                  {DOCUMENT_TYPES.find((t) => t.key === v.docType)?.label ?? v.docType}
                  {v.title ? `, ${v.title}` : ""} on {day(v.viewedAt)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

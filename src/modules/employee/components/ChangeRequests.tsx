/**
 * "Request a change" (E7). A person asks; an Admin makes the change with the
 * editors and then closes the request. Nothing on the record changes when a
 * request is sent: an address change closes a row for good (rule 2), so the
 * person describes it and an Admin, who can see the history, makes it.
 */

import { useCallback, useEffect, useState } from "react";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isAppError } from "@/platform/errors";
import {
  CHANGE_SECTIONS,
  type ChangeRequest,
  type ChangeRequestStatus,
  type EmployeeCard,
} from "../contracts";
import { listChangeRequests, requestChange, resolveChange } from "../handlers";
import { formatDate } from "../format";
import { Panel } from "./parts";
import { PersonLink } from "./PersonLink";

const SECTION_LABEL: Record<string, string> = Object.fromEntries(CHANGE_SECTIONS);
const STATUS: Record<ChangeRequestStatus, [string, StatusTone]> = {
  open: ["Waiting", "warning"],
  done: ["Made", "success"],
  declined: ["Declined", "neutral"],
};

const input = "w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

/** The button and dialog on your own card. */
export function RequestChangeButton({ card, onSent }: { card: EmployeeCard; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string>("contact");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await requestChange(card.id, section, details);
      setOpen(false);
      onSent();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="request-change"
        onClick={() => {
          setSection("contact");
          setDetails("");
          setError("");
          setOpen(true);
        }}
        className="h-11 rounded-md border border-border px-4 text-sm font-medium"
      >
        Request a change
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a change</DialogTitle>
            <DialogDescription>
              Your HR admins are told. Nothing on your record changes until one of them makes the
              change, and you&apos;ll hear when they have.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-3">
            <label className="text-sm">
              <span className="block font-medium">What is it about?</span>
              <select
                data-testid="request-section"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className={`mt-1 h-11 ${input}`}
              >
                {CHANGE_SECTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block font-medium">What should it say, and from when?</span>
              <textarea
                data-testid="request-details"
                required
                rows={4}
                maxLength={2000}
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value);
                  setError("");
                }}
                placeholder="I moved to 9 Lake View, Hosur 635109 on 1 June."
                className={`mt-1 py-2 ${input}`}
              />
            </label>
            {error && (
              <p role="alert" data-testid="request-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || details.trim().length < 3}
              data-testid="request-send"
              className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              {busy ? "Sending…" : "Send to HR"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Your own requests and what happened to them, on your card. */
export function MyChangeRequests({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<ChangeRequest[] | null>(null);
  useEffect(() => {
    listChangeRequests(null)
      .then(setRows)
      .catch(() => setRows([]));
  }, [refreshKey]);
  if (!rows || rows.length === 0) return null;
  return (
    <Panel title="Your change requests" testId="my-change-requests">
      <ul className="flex flex-col gap-3 text-sm">
        {rows.slice(0, 10).map((r) => (
          <li key={r.id} data-testid="my-change-request">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{SECTION_LABEL[r.section] ?? r.section}</span>
              <StatusBadge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</StatusBadge>
              <span className="text-caption text-muted-foreground">{formatDate(r.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-foreground-secondary">{r.details}</p>
            {r.resolutionNote && (
              <p className="mt-0.5 text-caption text-muted-foreground">
                {r.resolvedByName ?? "HR"}: {r.resolutionNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The Admin's list: Employees › Company › Change requests. */
export default function ChangeRequestsScreen() {
  const [status, setStatus] = useState<ChangeRequestStatus>("open");
  const [rows, setRows] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setRows(null);
    listChangeRequests(status)
      .then(setRows)
      .catch((e: unknown) => {
        setRows([]);
        setError(isAppError(e) ? e.message : "Change requests didn't load.");
      });
  }, [status]);

  useEffect(load, [load]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Change requests</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          What people have asked to be corrected on their own record. Make the change on their card,
          then mark it made here so they hear.
        </p>
      </div>
      <div role="tablist" aria-label="Status" className="flex gap-1 border-b border-border">
        {(["open", "done", "declined"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`-mb-px h-11 border-b-2 px-3 text-sm ${status === s ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}
          >
            {s === "open" ? "Waiting" : s === "done" ? "Made" : "Declined"}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows === null ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <p data-testid="change-requests-empty" className="text-sm text-muted-foreground">
          {status === "open" ? "Nothing waiting. Nobody has asked for a change." : "None."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <ChangeRequestRow key={r.id} request={r} onResolved={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRequestRow({
  request: r,
  onResolved,
}: {
  request: ChangeRequest;
  onResolved: () => void;
}) {
  const [deciding, setDeciding] = useState<"done" | "declined" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function resolve() {
    if (!deciding) return;
    setError("");
    setBusy(true);
    try {
      await resolveChange(r.id, deciding, note);
      onResolved();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid="change-request-row"
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PersonLink employeeId={r.employeeId} className="font-medium">
          {r.employeeName ?? "Somebody"}
        </PersonLink>
        <span className="text-sm text-foreground-secondary">
          {SECTION_LABEL[r.section] ?? r.section}
        </span>
        <StatusBadge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</StatusBadge>
        <span className="ml-auto text-caption text-muted-foreground">
          {formatDate(r.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-sm whitespace-pre-wrap">{r.details}</p>
      {r.resolutionNote && (
        <p className="mt-2 text-caption text-muted-foreground">
          {r.resolvedByName ?? "An admin"}, {formatDate(r.resolvedAt)}: {r.resolutionNote}
        </p>
      )}
      {r.status === "open" &&
        (deciding ? (
          <div className="mt-3 grid gap-2">
            <label className="text-sm">
              <span className="block font-medium">
                {deciding === "done" ? "A note for them (optional)" : "Why not? They'll see this."}
              </span>
              <input
                data-testid="resolve-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={`mt-1 h-11 ${input}`}
              />
            </label>
            {error && (
              <p role="alert" data-testid="resolve-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void resolve()}
                disabled={busy || (deciding === "declined" && note.trim().length < 3)}
                data-testid="resolve-confirm"
                className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
              >
                {busy ? "Saving…" : deciding === "done" ? "Mark as made" : "Decline"}
              </button>
              <button
                type="button"
                onClick={() => setDeciding(null)}
                className="h-11 rounded-md border border-border px-4 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="resolve-done"
              onClick={() => {
                setNote("");
                setDeciding("done");
              }}
              className="h-11 rounded-md border border-border px-4 text-sm font-medium"
            >
              Made the change
            </button>
            <button
              type="button"
              data-testid="resolve-decline"
              onClick={() => {
                setNote("");
                setDeciding("declined");
              }}
              className="h-11 rounded-md border border-border px-4 text-sm"
            >
              Decline
            </button>
          </div>
        ))}
    </li>
  );
}

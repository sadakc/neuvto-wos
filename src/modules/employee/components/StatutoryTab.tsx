/**
 * Statutory and bank (bundle §7.1, D80).
 *
 * What arrives decides what renders, as everywhere on the card: a block the
 * database did not send is not drawn. Numbers arrive as their last four unless
 * §5 grants them in full (UAN, EPF and ESIC to Payroll and Statutory).
 *
 * A full Aadhaar, PAN, account or restricted value exists in this browser only
 * after a reveal, and only here:
 *
 *   - in this component's state, never a cache, a URL or a log line;
 *   - gone when the component unmounts, so on leaving the tab or the page;
 *   - gone two minutes after the last reveal, whatever the person is doing;
 *   - asked for with a stated reason, which the database keeps with the look.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { isAppError } from "@/platform/errors";
import {
  CASTE_CATEGORIES,
  CHECK_STATUSES,
  DISABILITY_STATUSES,
  type EmployeeCard,
  type RestrictedRead,
  type RevealField,
  type Revealed,
} from "../contracts";
import {
  getRestrictedReads,
  revealRestricted,
  setBank,
  setRestricted,
  setStatutory,
} from "../handlers";
import { formatDate, humanise } from "../format";
import { Fields, Panel } from "./parts";

export const REVEAL_LIFETIME_MS = 2 * 60 * 1000;

const lastFour = (v: string | null | undefined) => (v ? `•••• ${v}` : null);

export function StatutoryTab({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const caps = card.capabilities;
  const [revealed, setRevealed] = useState<Revealed>({});
  const [asking, setAsking] = useState<RevealField[] | null>(null);
  const [reads, setReads] = useState<RestrictedRead[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadReads = useCallback(() => {
    if (!caps.canSeeReveals) return;
    getRestrictedReads(card.id)
      .then(setReads)
      .catch(() => setReads([]));
  }, [caps.canSeeReveals, card.id]);

  useEffect(() => {
    loadReads();
  }, [loadReads]);

  // Dropped on unmount; the state goes with the component anyway, but the
  // timer must not fire into a component that no longer exists.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onRevealed(values: Revealed) {
    setRevealed((current) => ({ ...current, ...values }));
    setAsking(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealed({}), REVEAL_LIFETIME_MS);
    loadReads();
  }

  function hideAll() {
    if (timer.current) clearTimeout(timer.current);
    setRevealed({});
  }

  const anyRevealed = Object.keys(revealed).length > 0;
  const st = card.statutory;

  return (
    <div className="flex flex-col gap-4">
      <p
        data-testid="statutory-warning"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-line bg-warning-muted px-3.5 py-2.5 text-sm"
      >
        <span className="min-w-0 flex-1">
          Numbers show their last four. Revealing one is logged against your account with the reason
          you give, and the log is kept for three years.
        </span>
        {anyRevealed && (
          <button
            type="button"
            onClick={hideAll}
            data-testid="hide-revealed"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium"
          >
            Hide everything shown
          </button>
        )}
      </p>

      <div className="grid gap-4 @min-[800px]/app:grid-cols-2">
        {st && (
          <Panel
            title="Provident fund and insurance"
            testId="panel-pf"
            footer="Old numbers matter at joining. If someone arrives with a previous UAN, the balance is transferred instead of a second account being opened."
          >
            <Fields
              items={[
                { label: "UAN", value: st.uan ?? lastFour(st.uanLast4), mono: true },
                { label: "EPF number", value: st.epfNumber ?? lastFour(st.epfLast4), mono: true },
                {
                  label: "ESIC number",
                  value: st.esicNumber ?? lastFour(st.esicLast4),
                  mono: true,
                },
                { label: "Old UAN", value: st.oldUan ?? lastFour(st.oldUanLast4), mono: true },
                {
                  label: "Old ESIC number",
                  value: st.oldEsicNumber ?? lastFour(st.oldEsicLast4),
                  mono: true,
                },
              ]}
            />
          </Panel>
        )}

        {st && (
          <Panel title="Identity documents" testId="panel-identity-docs">
            <Fields
              items={[
                { label: "Document given", value: humanise(st.identityDocumentType) },
                {
                  label: "Aadhaar",
                  value: (
                    <Secret
                      testId="aadhaar"
                      last4={st.aadhaarLast4}
                      value={revealed.aadhaar}
                      canReveal={!!caps.canRevealStatutory}
                      onAsk={() => setAsking(["aadhaar"])}
                    />
                  ),
                },
                {
                  label: "PAN",
                  value: (
                    <Secret
                      testId="pan"
                      last4={st.panLast4}
                      value={revealed.pan}
                      canReveal={!!caps.canRevealStatutory}
                      onAsk={() => setAsking(["pan"])}
                    />
                  ),
                },
                { label: "Verified on", value: formatDate(st.verifiedOn) },
              ]}
            />
          </Panel>
        )}

        {card.bank && (
          <Panel title="Bank" testId="panel-bank">
            <Fields
              items={[
                { label: "Bank", value: card.bank.bankName },
                ...("branch" in card.bank ? [{ label: "Branch", value: card.bank.branch }] : []),
                {
                  label: "Account",
                  value: (
                    <Secret
                      testId="bank-account"
                      last4={card.bank.accountLast4}
                      value={revealed.bankAccount}
                      canReveal={!!caps.canRevealBank}
                      onAsk={() => setAsking(["bank_account"])}
                    />
                  ),
                },
                { label: "IFSC", value: card.bank.ifsc, mono: true },
                ...("accountHolder" in card.bank
                  ? [{ label: "Account holder", value: card.bank.accountHolder }]
                  : []),
                { label: "Penny drop", value: humanise(card.bank.pennyDropStatus) },
              ]}
            />
          </Panel>
        )}

        {card.verification && (
          <Panel title="Verification" testId="panel-verification">
            <Fields
              items={[
                {
                  label: "Police verification",
                  value: humanise(card.verification.policeVerification),
                },
                { label: "Verified on", value: formatDate(card.verification.policeVerifiedOn) },
                ...("nearestPoliceStation" in card
                  ? [{ label: "Nearest police station", value: card.nearestPoliceStation }]
                  : []),
                {
                  label: "Previous employer check",
                  value: humanise(card.verification.previousEmployerCheck),
                },
                { label: "Education check", value: humanise(card.verification.educationCheck) },
                {
                  label: "Re-verification due",
                  value: formatDate(card.verification.reverificationDue),
                },
              ]}
            />
          </Panel>
        )}

        {card.restricted && (
          <Panel title="Restricted" testId="panel-restricted-values">
            <p className="text-sm text-foreground-secondary">
              Religion, caste category and disability status. Only the Statutory role and the person
              themselves can see them, and every look is logged.
            </p>
            {!card.restricted.recorded ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing recorded.</p>
            ) : revealed.religion !== undefined ||
              revealed.casteCategory !== undefined ||
              revealed.disabilityStatus !== undefined ? (
              <div className="mt-3" data-testid="restricted-revealed">
                <Fields
                  items={[
                    { label: "Religion", value: revealed.religion },
                    { label: "Caste category", value: humanise(revealed.casteCategory) },
                    {
                      label: "Disability",
                      value:
                        humanise(revealed.disabilityStatus) +
                        (revealed.disabilityPercent != null
                          ? ` (${revealed.disabilityPercent}%)`
                          : ""),
                    },
                  ]}
                />
                <StatusBadge tone="warning" className="mt-2">
                  Shown, logged
                </StatusBadge>
              </div>
            ) : caps.canRevealRestricted ? (
              <button
                type="button"
                data-testid="reveal-restricted"
                onClick={() => setAsking(["religion", "caste_category", "disability"])}
                className="mt-3 h-10 rounded-md border border-border px-3 text-sm font-medium"
              >
                Reveal
              </button>
            ) : null}
          </Panel>
        )}
      </div>

      {asking && (
        <RevealPrompt
          employeeId={card.id}
          fields={asking}
          onCancel={() => setAsking(null)}
          onRevealed={onRevealed}
        />
      )}

      <Editors card={card} onChanged={onChanged} />

      {caps.canSeeReveals && (
        <Panel title="Who has looked" testId="panel-reads">
          {reads === null ? (
            <div className="h-8 animate-pulse rounded bg-muted" />
          ) : reads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has revealed anything on this record.
            </p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="reads-list">
              {reads.map((r, i) => (
                <li key={`${r.readAt}-${i}`}>
                  <span className="font-medium">{r.readerName ?? "Somebody"}</span> saw{" "}
                  {r.fields.map(humanise).join(", ").toLowerCase()} on {formatDate(r.readAt)}:{" "}
                  <span className="text-foreground-secondary">{r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

/** A restricted number: its last four, or the value once revealed. */
function Secret({
  last4,
  value,
  canReveal,
  onAsk,
  testId,
}: {
  last4: string | null;
  value: string | null | undefined;
  canReveal: boolean;
  onAsk: () => void;
  testId: string;
}) {
  if (!last4) return <span>—</span>;
  if (value) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-testid={`${testId}-value`}>
        <span className="font-mono">{value}</span>
        <StatusBadge tone="warning">Shown, logged</StatusBadge>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono" data-testid={`${testId}-masked`}>
        •••• {last4}
      </span>
      {canReveal && (
        <button
          type="button"
          onClick={onAsk}
          data-testid={`reveal-${testId}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Reveal
        </button>
      )}
    </span>
  );
}

const FIELD_NAMES: Record<RevealField, string> = {
  aadhaar: "the Aadhaar number",
  pan: "the PAN",
  bank_account: "the bank account number",
  religion: "the restricted data",
  caste_category: "the restricted data",
  disability: "the restricted data",
};

function RevealPrompt({
  employeeId,
  fields,
  onCancel,
  onRevealed,
}: {
  employeeId: string;
  fields: RevealField[];
  onCancel: () => void;
  onRevealed: (v: Revealed) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      onRevealed(await revealRestricted(employeeId, fields, reason));
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be shown.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="reveal-prompt"
      className="rounded-xl border border-warning-line bg-card p-4 shadow-card"
    >
      <label htmlFor="reveal-reason" className="block text-sm font-medium">
        Why do you need to see {FIELD_NAMES[fields[0]]}?
      </label>
      <p className="mt-0.5 text-caption text-muted-foreground">
        Kept with the record of this look, with your name and the time.
      </p>
      <input
        id="reveal-reason"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError("");
        }}
        autoFocus
        autoComplete="off"
        placeholder="ECR filing for September"
        data-testid="reveal-reason"
        className="mt-2 h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
      />
      {error && (
        <p role="alert" data-testid="reveal-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || reason.trim().length < 3}
          data-testid="reveal-confirm"
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Revealing…" : "Reveal and log"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════ editors

type FieldSpec = {
  key: string;
  label: string;
  kind?: "text" | "date" | "select";
  options?: readonly string[];
  /** What is on record, for a prefilled field. Numbers are never prefilled. */
  current?: string | null;
  placeholder?: string;
};

function Editors({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const caps = card.capabilities;
  const st = card.statutory;
  const bank = card.bank;
  const v = card.verification;
  const keep = (last4: string | null | undefined) =>
    last4 ? `•••• ${last4} on record. Type to replace.` : undefined;

  const editors: {
    id: string;
    title: string;
    fields: FieldSpec[];
    save: (vals: Record<string, string>) => Promise<void>;
  }[] = [];

  if (caps.canEditStatutory) {
    editors.push({
      id: "statutory",
      title: "Statutory numbers",
      fields: [
        { key: "aadhaar", label: "Aadhaar", placeholder: keep(st?.aadhaarLast4) },
        { key: "pan", label: "PAN", placeholder: keep(st?.panLast4) },
        { key: "uan", label: "UAN", placeholder: keep(st?.uanLast4) },
        { key: "epfNumber", label: "EPF number", placeholder: keep(st?.epfLast4) },
        { key: "esicNumber", label: "ESIC number", placeholder: keep(st?.esicLast4) },
        { key: "oldUan", label: "Old UAN", placeholder: keep(st?.oldUanLast4) },
        { key: "oldEsicNumber", label: "Old ESIC number", placeholder: keep(st?.oldEsicLast4) },
        {
          key: "identityDocumentType",
          label: "Document given",
          kind: "select",
          options: ["aadhaar", "pan", "passport", "voter_id", "driving_licence"],
          current: st?.identityDocumentType,
        },
        { key: "verifiedOn", label: "Verified on", kind: "date", current: st?.verifiedOn },
      ],
      save: (vals) => setStatutory(card.id, vals),
    });
  }
  if (caps.canEditVerification) {
    editors.push({
      id: "verification",
      title: "Verification",
      fields: [
        {
          key: "policeVerification",
          label: "Police verification",
          kind: "select",
          options: CHECK_STATUSES.filter((s) => s !== "not_applicable"),
          current: v?.policeVerification,
        },
        {
          key: "policeVerifiedOn",
          label: "Police verified on",
          kind: "date",
          current: v?.policeVerifiedOn,
        },
        {
          key: "previousEmployerCheck",
          label: "Previous employer check",
          kind: "select",
          options: CHECK_STATUSES,
          current: v?.previousEmployerCheck,
        },
        {
          key: "educationCheck",
          label: "Education check",
          kind: "select",
          options: CHECK_STATUSES.filter((s) => s !== "not_applicable"),
          current: v?.educationCheck,
        },
        {
          key: "reverificationDue",
          label: "Re-verification due",
          kind: "date",
          current: v?.reverificationDue,
        },
      ],
      save: (vals) => setStatutory(card.id, vals),
    });
  }
  if (caps.canEditBank) {
    editors.push({
      id: "bank",
      title: "Bank",
      fields: [
        { key: "bankName", label: "Bank", current: bank?.bankName },
        { key: "branch", label: "Branch", current: bank?.branch },
        { key: "account", label: "Account number", placeholder: keep(bank?.accountLast4) },
        { key: "ifsc", label: "IFSC", current: bank?.ifsc },
        { key: "accountHolder", label: "Account holder", current: bank?.accountHolder },
        {
          key: "pennyDropStatus",
          label: "Penny drop",
          kind: "select",
          options: ["not_checked", "verified", "failed"],
          current: bank?.pennyDropStatus,
        },
      ],
      save: (vals) => setBank(card.id, vals),
    });
  }
  if (caps.canEditRestricted) {
    editors.push({
      id: "restricted",
      title: "Restricted data",
      fields: [
        {
          key: "religion",
          label: "Religion",
          placeholder: "Leave blank to keep what is on record",
        },
        {
          key: "casteCategory",
          label: "Caste category",
          kind: "select",
          options: CASTE_CATEGORIES,
        },
        {
          key: "disabilityStatus",
          label: "Disability",
          kind: "select",
          options: DISABILITY_STATUSES,
        },
        { key: "disabilityPercent", label: "Disability percent", placeholder: "0 to 100" },
      ],
      save: (vals) => setRestricted(card.id, vals),
    });
  }

  if (editors.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {editors.map((ed) => (
        <Editor key={ed.id} {...ed} onSaved={onChanged} />
      ))}
    </div>
  );
}

function Editor({
  id,
  title,
  fields,
  save,
  onSaved,
}: {
  id: string;
  title: string;
  fields: FieldSpec[];
  save: (vals: Record<string, string>) => Promise<void>;
  onSaved: () => Promise<void> | void;
}) {
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, f.current ?? ""]));
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // Only what changed. An empty number field means "keep what is on record";
    // nothing on this form can blank a number by accident.
    const changed: Record<string, string> = {};
    for (const f of fields) {
      const now = vals[f.key].trim();
      const before = (f.current ?? "").trim();
      if (now !== before && now !== "") changed[f.key] = now;
    }
    if (Object.keys(changed).length === 0) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await save(changed);
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`edit-${id}`}
        onClick={() => {
          setVals(initial());
          setError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        Edit {title.toLowerCase()}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      data-testid={`editor-${id}`}
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <h3 className="text-card-title font-semibold tracking-card-title">{title}</h3>
      <div className="mt-3 grid gap-3 @min-[640px]/app:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="min-w-0 text-sm">
            <span className="block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
              {f.label}
            </span>
            {f.kind === "select" ? (
              <select
                value={vals[f.key]}
                onChange={(e) => setVals((c) => ({ ...c, [f.key]: e.target.value }))}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Not recorded</option>
                {f.options!.map((o) => (
                  <option key={o} value={o}>
                    {humanise(o)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.kind === "date" ? "date" : "text"}
                value={vals[f.key]}
                onChange={(e) => setVals((c) => ({ ...c, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                autoComplete="off"
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 font-mono"
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          data-testid={`editor-${id}-error`}
          className="mt-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          data-testid={`save-${id}`}
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

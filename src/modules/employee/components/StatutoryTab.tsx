/**
 * Statutory and bank (bundle §7.1, D80, D85).
 *
 * What arrives decides what renders, as everywhere on the card: a block the
 * database did not send is not drawn. Numbers arrive as their last four, shown
 * behind a lock; UAN, EPF and ESIC arrive in full only for Payroll and
 * Statutory.
 *
 * The eye (D85). Whoever the database lets open a number (the Employee Admin,
 * Statutory for numbers, Payroll for the account) clicks the eye and sees it.
 * Nothing is asked first; the database writes who looked, at what and when
 * before it answers. The person themselves sees their last four and no eye.
 *
 * A full value exists in this browser only after a look, and only here:
 *
 *   - in this component's state, never a cache, a URL or a log line;
 *   - gone when the component unmounts, so on leaving the tab or the page;
 *   - gone on a second click of the eye, or on "Hide everything shown";
 *   - gone two minutes after the last look, whatever the person is doing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
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
import { FieldEditor as Editor, type FieldSpec } from "./FieldEditor";
import { Fields, Panel } from "./parts";

export const REVEAL_LIFETIME_MS = 2 * 60 * 1000;

/** Which key of `Revealed` each field comes back as. */
const REVEALED_AS: Record<RevealField, keyof Revealed> = {
  uan: "uan",
  epf_number: "epfNumber",
  esic_number: "esicNumber",
  old_uan: "oldUan",
  old_esic_number: "oldEsicNumber",
  aadhaar: "aadhaar",
  pan: "pan",
  bank_account: "bankAccount",
  religion: "religion",
  caste_category: "casteCategory",
  disability: "disabilityStatus",
};

const RESTRICTED: RevealField[] = ["religion", "caste_category", "disability"];

export function StatutoryTab({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const caps = card.capabilities;
  const [revealed, setRevealed] = useState<Revealed>({});
  const [opening, setOpening] = useState<RevealField | null>(null);
  const [error, setError] = useState("");
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

  async function open(fields: RevealField[]) {
    setError("");
    setOpening(fields[0]);
    try {
      const values = await revealRestricted(card.id, fields);
      setRevealed((current) => ({ ...current, ...values }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRevealed({}), REVEAL_LIFETIME_MS);
      loadReads();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be shown.");
    } finally {
      setOpening(null);
    }
  }

  function lock(fields: RevealField[]) {
    setRevealed((current) => {
      const next = { ...current };
      for (const f of fields) delete next[REVEALED_AS[f]];
      if (fields.includes("disability")) delete next.disabilityPercent;
      return next;
    });
  }

  function hideAll() {
    if (timer.current) clearTimeout(timer.current);
    setRevealed({});
  }

  const anyRevealed = Object.keys(revealed).length > 0;
  const st = card.statutory;

  /** A number behind its lock, with the eye for whoever may open it. */
  const secret = (
    field: RevealField,
    label: string,
    testId: string,
    last4: string | null | undefined,
    full: string | null | undefined,
    canReveal: boolean,
  ) => (
    <Secret
      testId={testId}
      label={label}
      last4={last4 ?? null}
      // A value the card already carries in full (Payroll's UAN) needs no eye.
      value={full ?? (revealed[REVEALED_AS[field]] as string | null | undefined)}
      alwaysShown={!!full}
      canReveal={canReveal}
      busy={opening === field}
      onShow={() => void open([field])}
      onHide={() => lock([field])}
    />
  );

  const restrictedShown =
    revealed.religion !== undefined ||
    revealed.casteCategory !== undefined ||
    revealed.disabilityStatus !== undefined;

  return (
    <div className="flex flex-col gap-4">
      <p
        data-testid="statutory-warning"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-line bg-warning-muted px-3.5 py-2.5 text-sm"
      >
        <span className="min-w-0 flex-1">
          {caps.canRevealStatutory || caps.canRevealBank || caps.canRevealRestricted
            ? "Numbers are locked to their last four. The eye shows one; every look is logged with your name and kept for three years."
            : "Numbers show their last four. Your administrator can see them in full, and every look is logged where you can see it."}
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

      {error && (
        <p role="alert" data-testid="reveal-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 @min-[800px]/app:grid-cols-2">
        {st && (
          <Panel
            title="Provident fund and insurance"
            testId="panel-pf"
            footer="Old numbers matter at joining. If someone arrives with a previous UAN, the balance is transferred instead of a second account being opened."
          >
            <Fields
              items={[
                {
                  label: "UAN",
                  value: secret(
                    "uan",
                    "UAN",
                    "uan",
                    st.uanLast4,
                    st.uan,
                    !!caps.canRevealStatutory,
                  ),
                },
                {
                  label: "EPF number",
                  value: secret(
                    "epf_number",
                    "EPF number",
                    "epf",
                    st.epfLast4,
                    st.epfNumber,
                    !!caps.canRevealStatutory,
                  ),
                },
                {
                  label: "ESIC number",
                  value: secret(
                    "esic_number",
                    "ESIC number",
                    "esic",
                    st.esicLast4,
                    st.esicNumber,
                    !!caps.canRevealStatutory,
                  ),
                },
                {
                  label: "Old UAN",
                  value: secret(
                    "old_uan",
                    "old UAN",
                    "old-uan",
                    st.oldUanLast4,
                    st.oldUan,
                    !!caps.canRevealStatutory,
                  ),
                },
                {
                  label: "Old ESIC number",
                  value: secret(
                    "old_esic_number",
                    "old ESIC number",
                    "old-esic",
                    st.oldEsicLast4,
                    st.oldEsicNumber,
                    !!caps.canRevealStatutory,
                  ),
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
                  value: secret(
                    "aadhaar",
                    "Aadhaar",
                    "aadhaar",
                    st.aadhaarLast4,
                    null,
                    !!caps.canRevealStatutory,
                  ),
                },
                {
                  label: "PAN",
                  value: secret("pan", "PAN", "pan", st.panLast4, null, !!caps.canRevealStatutory),
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
                  value: secret(
                    "bank_account",
                    "account number",
                    "bank-account",
                    card.bank.accountLast4,
                    null,
                    !!caps.canRevealBank,
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
              Religion, caste category and disability status. Optional, entered by an administrator,
              and every look is logged.
            </p>
            {!card.restricted.recorded ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing recorded.</p>
            ) : restrictedShown ? (
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
                <span className="mt-2 inline-flex items-center gap-2">
                  <StatusBadge tone="warning">Shown, logged</StatusBadge>
                  <button
                    type="button"
                    onClick={() => lock(RESTRICTED)}
                    aria-label="Hide restricted data"
                    className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <EyeOff className="size-4" aria-hidden />
                  </button>
                </span>
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm">
                <Lock className="size-4 text-muted-foreground" aria-hidden />
                <span data-testid="restricted-held">Recorded</span>
                {caps.canRevealRestricted && (
                  <button
                    type="button"
                    data-testid="reveal-restricted"
                    aria-label="Show restricted data"
                    disabled={opening === "religion"}
                    onClick={() => void open(RESTRICTED)}
                    className="inline-flex size-9 items-center justify-center rounded-md text-primary hover:bg-muted disabled:opacity-45"
                  >
                    <Eye className="size-4" aria-hidden />
                  </button>
                )}
              </p>
            )}
          </Panel>
        )}
      </div>

      <Editors card={card} onChanged={onChanged} />

      {caps.canSeeReveals && (
        <Panel title="Who has looked" testId="panel-reads">
          {reads === null ? (
            <div className="h-8 animate-pulse rounded bg-muted" />
          ) : reads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has looked at anything locked on this record.
            </p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="reads-list">
              {reads.map((r, i) => (
                <li key={`${r.readAt}-${i}`}>
                  <span className="font-medium">{r.readerName ?? "Somebody"}</span> saw{" "}
                  {r.fields.map(humanise).join(", ").toLowerCase()} on {formatDate(r.readAt)}
                  {r.reason && (
                    <>
                      : <span className="text-foreground-secondary">{r.reason}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

/** A number: locked to its last four, or shown, with the eye between the two. */
function Secret({
  last4,
  value,
  alwaysShown,
  canReveal,
  busy,
  onShow,
  onHide,
  label,
  testId,
}: {
  last4: string | null;
  value: string | null | undefined;
  /** Sent in full on the card (Payroll's UAN): no lock and no eye. */
  alwaysShown: boolean;
  canReveal: boolean;
  busy: boolean;
  onShow: () => void;
  onHide: () => void;
  label: string;
  testId: string;
}) {
  if (alwaysShown && value) return <span className="font-mono">{value}</span>;
  if (!last4) return <span>—</span>;
  if (value) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-testid={`${testId}-value`}>
        <span className="font-mono">{value}</span>
        <StatusBadge tone="warning">Shown, logged</StatusBadge>
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${label}`}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <EyeOff className="size-4" aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Lock className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="font-mono" data-testid={`${testId}-masked`}>
        •••• {last4}
      </span>
      {canReveal && (
        <button
          type="button"
          onClick={onShow}
          disabled={busy}
          aria-label={`Show ${label}`}
          className="inline-flex size-9 items-center justify-center rounded-md text-primary hover:bg-muted disabled:opacity-45"
        >
          <Eye className="size-4" aria-hidden />
        </button>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════ editors

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
    save: (vals: Record<string, string | null>) => Promise<void>;
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

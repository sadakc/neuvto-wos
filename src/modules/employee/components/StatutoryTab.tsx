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
import { FilePicker } from "@/components/shared/file-picker";
import { StatusBadge } from "@/components/shared/status-badge";
import { isAppError } from "@/platform/errors";
import {
  CASTE_CATEGORIES,
  CHECK_STATUSES,
  DISABILITY_STATUSES,
  type EmployeeCard,
  type EmployeeDocument,
  type RestrictedRead,
  type RevealField,
  type Revealed,
} from "../contracts";
import {
  getRestrictedReads,
  listDocuments,
  openDocument,
  revealRestricted,
  setBank,
  setRestricted,
  setStatutory,
  uploadDocument,
} from "../handlers";
import { formatDate, humanise } from "../format";
import { FieldEditor as Editor, type FieldSpec } from "./FieldEditor";
import { withRequired } from "../fieldSettings";
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
  driving_licence: "drivingLicence",
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
  const editors = useEditors(card, onChanged);
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
            aside={editors.pf}
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
          <Panel title="Identity documents" testId="panel-identity-docs" aside={editors.ids}>
            <Fields
              items={[
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
                // D105: in place of "Document given", which the Documents tab now answers.
                {
                  label: "Driving licence",
                  value: secret(
                    "driving_licence",
                    "driving licence",
                    "licence",
                    st.licenceLast4,
                    null,
                    !!caps.canRevealStatutory,
                  ),
                },
                { label: "Verified on", value: formatDate(st.verifiedOn) },
              ]}
            />
          </Panel>
        )}

        {card.bank && (
          <Panel title="Bank" testId="panel-bank" aside={editors.bank}>
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
            {caps.canEditBank && <BankProof employeeId={card.id} />}
          </Panel>
        )}

        {card.verification && (
          <Panel title="Verification" testId="panel-verification" aside={editors.verification}>
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
          <Panel title="Restricted" testId="panel-restricted-values" aside={editors.restricted}>
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

/**
 * The passbook's first page or a cancelled cheque (D104), on the bank panel
 * where it is checked against. It is the Documents tab's "bank_proof": the
 * same storage, the same logged opening, and a new photo replaces the old one,
 * which stays in the record.
 */
function BankProof({ employeeId }: { employeeId: string }) {
  const [doc, setDoc] = useState<EmployeeDocument | null | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      listDocuments(employeeId)
        .then((docs) => setDoc(docs.find((d) => d.docType === "bank_proof") ?? null))
        .catch(() => setDoc(null)),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      await uploadDocument({ employeeId, docType: "bank_proof", title: "", expiresOn: null, file });
      setFile(null);
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "The image didn't upload. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function view(id: string) {
    setError("");
    try {
      window.open(await openDocument(id), "_blank", "noopener");
    } catch (err) {
      setError(isAppError(err) ? err.message : "That couldn't be opened.");
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="bank-proof">
      <p className="text-sm">
        <span className="font-medium">Passbook or cancelled cheque: </span>
        {doc === undefined ? (
          <span className="text-muted-foreground">checking…</span>
        ) : doc ? (
          <>
            <span className="text-foreground-secondary">on file</span>{" "}
            <button
              type="button"
              onClick={() => void view(doc.id)}
              className="inline-flex min-h-9 items-center text-primary underline underline-offset-4"
            >
              View
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">not uploaded yet</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <FilePicker
          label={doc ? "Replace the image" : "Upload an image"}
          file={file}
          onChange={setFile}
          testId="bank-proof-file"
          hint="A photo or PDF of the passbook's first page or a cancelled cheque, up to 10 MB. Opening it is logged."
        />
        {file && (
          <button
            type="button"
            onClick={() => void upload()}
            disabled={busy}
            data-testid="bank-proof-upload"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
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
      // The number and its eye stay on one line (D104); the notice that the
      // look was logged goes under them rather than pushing the eye down.
      <span className="inline-flex flex-col items-start gap-1" data-testid={`${testId}-value`}>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="font-mono">{value}</span>
          <button
            type="button"
            onClick={onHide}
            aria-label={`Hide ${label}`}
            className="-my-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <EyeOff className="size-4" aria-hidden />
          </button>
        </span>
        <StatusBadge tone="warning">Shown, logged</StatusBadge>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      data-testid={`${testId}-locked`}
    >
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
          className="-my-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-primary hover:bg-muted disabled:opacity-45"
        >
          <Eye className="size-4" aria-hidden />
        </button>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════ editors

/**
 * One editor per panel, for the panel's header (D103): "Add …" while nothing
 * is recorded there, "Edit …" once something is. A number on record shows its
 * last four with Change beside it (D104); only a number the Admin changes is
 * typed and sent, and an empty number field keeps what is on record. Each is
 * checked on the screen against the rule the database refuses with.
 */
function useEditors(card: EmployeeCard, onChanged: () => Promise<void> | void) {
  const caps = card.capabilities;
  const st = card.statutory;
  const bank = card.bank;
  const v = card.verification;
  const has = (...xs: unknown[]) => xs.some((x) => x !== null && x !== undefined && x !== "");
  const editor = (
    id: string,
    title: string,
    filled: boolean,
    fields: FieldSpec[],
    save: (vals: Record<string, string | null>) => Promise<void>,
    crossCheck?: (vals: Record<string, string>) => Record<string, string>,
  ) => (
    <Editor
      id={id}
      title={title}
      filled={filled}
      // D107: the company's Required holds here too.
      fields={withRequired(card, fields)}
      save={save}
      onSaved={onChanged}
      crossCheck={crossCheck}
    />
  );

  return {
    pf: caps.canEditStatutory
      ? editor(
          "pf",
          "PF and insurance numbers",
          has(st?.uanLast4, st?.epfLast4, st?.esicLast4, st?.oldUanLast4, st?.oldEsicLast4),
          [
            {
              key: "uan",
              label: "UAN",
              masked: st?.uanLast4,
              rule: "uan",
              inputMode: "numeric",
            },
            { key: "epfNumber", label: "EPF number", masked: st?.epfLast4, rule: "epf" },
            {
              key: "esicNumber",
              label: "ESIC number",
              masked: st?.esicLast4,
              rule: "esic",
              inputMode: "numeric",
            },
            {
              key: "oldUan",
              label: "Old UAN",
              masked: st?.oldUanLast4,
              rule: "uan",
              inputMode: "numeric",
            },
            {
              key: "oldEsicNumber",
              label: "Old ESIC number",
              masked: st?.oldEsicLast4,
              rule: "esic",
              inputMode: "numeric",
            },
          ],
          (vals) => setStatutory(card.id, vals),
          // D105: the same number twice is a slip. One already on record is
          // known only by its last four here; the database checks that case.
          (vals) => {
            const same = (a: string, b: string) => {
              const n = (x: string) => x.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
              return n(a) !== "" && n(a) === n(b);
            };
            const found: Record<string, string> = {};
            if (same(vals.uan ?? "", vals.oldUan ?? "")) {
              found.oldUan =
                "The old UAN is the same as the current one. An old UAN is a previous account.";
            }
            if (same(vals.esicNumber ?? "", vals.oldEsicNumber ?? "")) {
              found.oldEsicNumber =
                "The old ESIC number is the same as the current one. An old number is a previous one.";
            }
            return found;
          },
        )
      : null,
    ids: caps.canEditStatutory
      ? editor(
          "identity-docs",
          "Identity documents",
          has(st?.aadhaarLast4, st?.panLast4, st?.licenceLast4, st?.verifiedOn),
          [
            {
              key: "aadhaar",
              label: "Aadhaar",
              masked: st?.aadhaarLast4,
              rule: "aadhaar",
              inputMode: "numeric",
            },
            { key: "pan", label: "PAN", masked: st?.panLast4, rule: "pan" },
            {
              key: "drivingLicence",
              label: "Driving licence",
              masked: st?.licenceLast4,
              rule: "licence",
            },
            {
              key: "verifiedOn",
              label: "Verified on",
              kind: "date",
              current: st?.verifiedOn,
              rule: "pastDate",
            },
          ],
          (vals) => setStatutory(card.id, vals),
        )
      : null,
    verification: caps.canEditVerification
      ? editor(
          "verification",
          "Verification",
          has(v?.policeVerifiedOn, v?.reverificationDue) ||
            [v?.policeVerification, v?.previousEmployerCheck, v?.educationCheck].some(
              (x) => x && x !== "not_started",
            ),
          [
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
              rule: "pastDate",
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
          (vals) => setStatutory(card.id, vals),
        )
      : null,
    bank: caps.canEditBank
      ? editor(
          "bank",
          "Bank",
          has(bank?.bankName, bank?.branch, bank?.accountLast4, bank?.ifsc, bank?.accountHolder),
          [
            {
              key: "bankName",
              label: "Bank",
              current: bank?.bankName,
              rule: "text100",
              maxLength: 100,
            },
            {
              key: "branch",
              label: "Branch",
              current: bank?.branch,
              rule: "text100",
              maxLength: 100,
            },
            {
              key: "account",
              label: "Account number",
              masked: bank?.accountLast4,
              rule: "account",
              inputMode: "numeric",
            },
            { key: "ifsc", label: "IFSC", current: bank?.ifsc, rule: "ifsc", maxLength: 11 },
            {
              key: "accountHolder",
              label: "Account holder",
              current: bank?.accountHolder,
              rule: "name",
              maxLength: 100,
            },
            {
              key: "pennyDropStatus",
              label: "Penny drop",
              kind: "select",
              options: ["not_checked", "verified", "failed"],
              current: bank?.pennyDropStatus,
            },
          ],
          (vals) => setBank(card.id, vals),
        )
      : null,
    restricted: caps.canEditRestricted
      ? editor(
          "restricted",
          "Restricted data",
          !!card.restricted?.recorded,
          [
            {
              key: "religion",
              label: "Religion",
              placeholder: "Leave blank to keep what is on record",
              rule: "words",
              maxLength: 60,
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
            {
              key: "disabilityPercent",
              label: "Disability percent",
              placeholder: "0 to 100",
              rule: "percent",
              inputMode: "numeric",
            },
          ],
          (vals) => setRestricted(card.id, vals),
        )
      : null,
  };
}

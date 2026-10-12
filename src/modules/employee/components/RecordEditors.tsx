/**
 * Writing the record (E7). Every control here is an Admin's (§5) and renders
 * only when the card says `canEdit`; the database refuses everybody else
 * anyway, so this is about not offering a dead button.
 *
 * Three shapes, after the three rules (§2):
 *   - the record's own fields: a FieldEditor per panel;
 *   - repeating rows (family, previous organisations): the whole list edited
 *     and saved at once, any number of rows, no "Son 1";
 *   - history (addresses, postings, nominations): never edited, only
 *     superseded, through a dialog that says what it will close before
 *     anything is typed.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isAppError } from "@/platform/errors";
import {
  ADDRESS_TYPES,
  BLOOD_GROUPS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  MARITAL_STATUSES,
  NOMINATION_SCHEMES,
  RELATIONS,
  SEXES,
  type EmployeeCard,
} from "../contracts";
import {
  addAddress,
  listActiveUnits,
  listDesignations,
  moveUnit,
  saveFamily,
  saveNomination,
  savePreviousOrgs,
  updateEmployee,
  type Option,
} from "../handlers";
import { familySummary, formatDate, humanise, shareTotal, todayIso } from "../format";
import { FieldEditor, type FieldSpec } from "./FieldEditor";

type Changed = () => Promise<void> | void;

const input = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const eyebrow = "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";

function errorText(err: unknown, fallback: string) {
  return isAppError(err) ? err.message : fallback;
}

// ═══════════════════════════════════════════════════════════ own fields

function RecordFieldEditor({
  card,
  id,
  title,
  fields,
  onChanged,
}: {
  card: EmployeeCard;
  id: string;
  title: string;
  fields: FieldSpec[];
  onChanged: Changed;
}) {
  return (
    <FieldEditor
      id={id}
      title={title}
      fields={fields.map((f) => ({ clearable: true, ...f }))}
      save={(vals) => updateEmployee(card.id, vals)}
      onSaved={onChanged}
    />
  );
}

export function ContactEditors({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <div className="flex flex-wrap gap-2">
      <RecordFieldEditor
        card={card}
        id="contact"
        title="Contact"
        onChanged={onChanged}
        fields={[
          {
            key: "alternateMobile",
            label: "Alternate mobile",
            current: card.alternateMobile,
            inputMode: "tel",
          },
          {
            key: "personalEmail",
            label: "Personal email",
            current: card.personalEmail,
            inputMode: "email",
          },
        ]}
      />
      <RecordFieldEditor
        card={card}
        id="emergency"
        title="Emergency contact"
        onChanged={onChanged}
        fields={[
          { key: "emergencyContactName", label: "Name", current: card.emergencyContact?.name },
          {
            key: "emergencyContactRelation",
            label: "Relation",
            current: card.emergencyContact?.relation,
          },
          {
            key: "emergencyContactPhone",
            label: "Phone",
            current: card.emergencyContact?.phone,
            inputMode: "tel",
          },
        ]}
      />
    </div>
  );
}

export function PersonalEditors({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <div className="flex flex-wrap gap-2">
      <RecordFieldEditor
        card={card}
        id="identity"
        title="Identity"
        onChanged={onChanged}
        fields={[
          { key: "nameAsPerId", label: "Name as printed on ID", current: card.nameAsPerId },
          { key: "sex", label: "Sex", kind: "select", options: SEXES, current: card.sex },
          { key: "dateOfBirth", label: "Date of birth", kind: "date", current: card.dateOfBirth },
          {
            key: "maritalStatus",
            label: "Marital status",
            kind: "select",
            options: MARITAL_STATUSES,
            current: card.maritalStatus,
          },
          { key: "nationality", label: "Nationality", current: card.nationality },
          { key: "nativeState", label: "Native state", current: card.nativeState },
        ]}
      />
      <RecordFieldEditor
        card={card}
        id="education"
        title="Education"
        onChanged={onChanged}
        fields={[
          {
            key: "educationQualification",
            label: "Qualification",
            current: card.educationQualification,
          },
          {
            key: "reasonForLeavingLastOrg",
            label: "Reason for leaving last org",
            current: card.reasonForLeavingLastOrg,
          },
        ]}
      />
      <RecordFieldEditor
        card={card}
        id="physical"
        title="Physical record"
        onChanged={onChanged}
        fields={[
          {
            key: "heightCm",
            label: "Height (cm)",
            current: card.physical?.heightCm?.toString(),
            inputMode: "numeric",
          },
          {
            key: "chestCm",
            label: "Chest (cm)",
            current: card.physical?.chestCm?.toString(),
            inputMode: "numeric",
          },
          {
            key: "weightKg",
            label: "Weight (kg)",
            current: card.physical?.weightKg?.toString(),
            inputMode: "numeric",
          },
          {
            key: "bloodGroup",
            label: "Blood group",
            kind: "select",
            labelled: BLOOD_GROUPS.map((b) => [b, b] as const),
            current: card.bloodGroup,
          },
          {
            key: "nearestPoliceStation",
            label: "Nearest police station",
            current: card.nearestPoliceStation,
          },
        ]}
      />
    </div>
  );
}

export function EmploymentEditors({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const [designations, setDesignations] = useState<Option[] | null>(null);
  useEffect(() => {
    listDesignations()
      .then(setDesignations)
      .catch(() => setDesignations([]));
  }, []);
  // The current designation stays selectable even if it has since been
  // retired, so the select never shows a different value from the record's.
  const current = card.designation;
  const options: [string, string][] = (designations ?? []).map((d) => [
    d.id,
    d.detail ? `${d.name} (${d.detail})` : d.name,
  ]);
  if (current && !options.some(([id]) => id === current.id)) {
    options.unshift([current.id, `${current.name} (retired)`]);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <RecordFieldEditor
        card={card}
        id="position"
        title="Position"
        onChanged={onChanged}
        fields={[
          { key: "employeeCode", label: "Employee code", current: card.employeeCode },
          {
            key: "designationId",
            label: "Designation",
            kind: "select",
            labelled: options,
            current: current?.id,
          },
          {
            key: "employmentType",
            label: "Employment type",
            kind: "select",
            labelled: EMPLOYMENT_TYPES.map((t) => [t, EMPLOYMENT_TYPE_LABEL[t]] as const),
            current: card.employmentType,
          },
        ]}
      />
      <RecordFieldEditor
        card={card}
        id="dates"
        title="Dates and status"
        onChanged={onChanged}
        fields={[
          { key: "reJoiningDate", label: "Re-joined", kind: "date", current: card.reJoiningDate },
          { key: "confirmedOn", label: "Confirmed", kind: "date", current: card.confirmedOn },
          {
            key: "status",
            label: "Status",
            kind: "select",
            labelled: EMPLOYEE_STATUSES.map((s) => [s, EMPLOYEE_STATUS_LABEL[s]] as const),
            current: card.status,
          },
          {
            key: "terminationDate",
            label: "Termination date",
            kind: "date",
            current: card.terminationDate,
          },
          {
            key: "terminationReason",
            label: "Termination reason",
            current: card.terminationReason,
          },
        ]}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ repeating rows

interface FamilyRow {
  key: string;
  id?: string;
  relation: string;
  name: string;
  dateOfBirth: string;
  isDependent: boolean;
}

let rowSeq = 0;
const newKey = () => `new-${++rowSeq}`;

export function FamilyEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const fromCard = (): FamilyRow[] =>
    (card.familyMembers ?? []).map((f) => ({
      key: f.id,
      id: f.id,
      relation: f.relation,
      name: f.name,
      dateOfBirth: f.dateOfBirth ?? "",
      isDependent: f.isDependent,
    }));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FamilyRow[]>(fromCard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key: string, patch: Partial<FamilyRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    if (rows.some((r) => !r.name.trim())) {
      setError("Every row needs a name, or remove it.");
      return;
    }
    setBusy(true);
    try {
      await saveFamily(
        card.id,
        rows.map((r) => ({
          id: r.id,
          relation: r.relation,
          name: r.name.trim(),
          dateOfBirth: r.dateOfBirth || null,
          isDependent: r.isDependent,
        })),
      );
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err, "The family list couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="edit-family"
        onClick={() => {
          setRows(fromCard());
          setError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        Edit family
      </button>
    );
  }

  return (
    <section
      data-testid="family-editor"
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-card-title font-semibold tracking-card-title">Family</h3>
        <span
          className="ml-auto text-caption text-muted-foreground"
          data-testid="family-editor-summary"
        >
          {familySummary(rows.map((r) => r.relation))}
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li
            key={r.key}
            data-testid="family-editor-row"
            className="grid gap-2 rounded-lg border border-border p-3 @min-[720px]/app:grid-cols-[9rem_1fr_10rem_auto_auto] @min-[720px]/app:items-end"
          >
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Relation</span>
              <select
                aria-label={`Relation, row ${i + 1}`}
                value={r.relation}
                onChange={(e) => set(r.key, { relation: e.target.value })}
                className={`mt-1 ${input}`}
              >
                {RELATIONS.map((rel) => (
                  <option key={rel} value={rel}>
                    {humanise(rel)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Name</span>
              <input
                aria-label={`Name, row ${i + 1}`}
                value={r.name}
                onChange={(e) => set(r.key, { name: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Date of birth</span>
              <input
                type="date"
                value={r.dateOfBirth}
                onChange={(e) => set(r.key, { dateOfBirth: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="flex h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.isDependent}
                onChange={(e) => set(r.key, { isDependent: e.target.checked })}
                className="size-4"
              />
              Dependent
            </label>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              aria-label={`Remove row ${i + 1}`}
              className="h-11 rounded-md border border-border px-3 text-sm"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="family-add-row"
        onClick={() =>
          setRows((rs) => [
            ...rs,
            { key: newKey(), relation: "son", name: "", dateOfBirth: "", isDependent: true },
          ])
        }
        className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
      >
        Add a relative
      </button>
      <p className="mt-3 text-caption text-muted-foreground">
        There is no Son 1 and Son 2. Add as many sons, daughters or other relatives as the person
        actually has, in any order.
      </p>
      {error && (
        <p role="alert" data-testid="family-editor-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          data-testid="family-save"
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Saving…" : "Save family"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

interface PrevRow {
  key: string;
  id?: string;
  organisationName: string;
  designation: string;
  fromDate: string;
  toDate: string;
  reasonForLeaving: string;
}

export function PreviousOrgsEditor({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: Changed;
}) {
  const fromCard = (): PrevRow[] =>
    (card.previousOrganisations ?? []).map((p) => ({
      key: p.id,
      id: p.id,
      organisationName: p.organisationName,
      designation: p.designation ?? "",
      fromDate: p.fromDate,
      toDate: p.toDate,
      reasonForLeaving: p.reasonForLeaving ?? "",
    }));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PrevRow[]>(fromCard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, patch: Partial<PrevRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    if (rows.some((r) => !r.organisationName.trim() || !r.fromDate || !r.toDate)) {
      setError("Every row needs an organisation and both dates, or remove it.");
      return;
    }
    setBusy(true);
    try {
      await savePreviousOrgs(
        card.id,
        rows.map((r) => ({
          id: r.id,
          organisationName: r.organisationName.trim(),
          designation: r.designation.trim() || null,
          fromDate: r.fromDate,
          toDate: r.toDate,
          reasonForLeaving: r.reasonForLeaving.trim() || null,
        })),
      );
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err, "Previous organisations couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="edit-previous-orgs"
        onClick={() => {
          setRows(fromCard());
          setError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        Edit previous organisations
      </button>
    );
  }

  return (
    <section
      data-testid="previous-orgs-editor"
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <h3 className="text-card-title font-semibold tracking-card-title">Previous organisations</h3>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li
            key={r.key}
            className="grid gap-2 rounded-lg border border-border p-3 @min-[720px]/app:grid-cols-2"
          >
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Organisation</span>
              <input
                aria-label={`Organisation, row ${i + 1}`}
                value={r.organisationName}
                onChange={(e) => set(r.key, { organisationName: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Designation</span>
              <input
                value={r.designation}
                onChange={(e) => set(r.key, { designation: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>From</span>
              <input
                type="date"
                aria-label={`From, row ${i + 1}`}
                value={r.fromDate}
                onChange={(e) => set(r.key, { fromDate: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>To</span>
              <input
                type="date"
                aria-label={`To, row ${i + 1}`}
                value={r.toDate}
                onChange={(e) => set(r.key, { toDate: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm @min-[720px]/app:col-span-2">
              <span className={eyebrow}>Reason for leaving</span>
              <input
                value={r.reasonForLeaving}
                onChange={(e) => set(r.key, { reasonForLeaving: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              className="h-11 w-fit rounded-md border border-border px-3 text-sm"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="previous-orgs-add-row"
        onClick={() =>
          setRows((rs) => [
            ...rs,
            {
              key: newKey(),
              organisationName: "",
              designation: "",
              fromDate: "",
              toDate: "",
              reasonForLeaving: "",
            },
          ])
        }
        className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
      >
        Add an organisation
      </button>
      {error && (
        <p role="alert" data-testid="previous-orgs-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          data-testid="previous-orgs-save"
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
    </section>
  );
}

// ═══════════════════════════════════════════════════════════ nominees

interface NomineeRow {
  key: string;
  name: string;
  relation: string;
  dateOfBirth: string;
  share: string;
}

export function NominationEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const current = card.nominations?.find((n) => !n.effectiveTo);
  const fromCard = (): NomineeRow[] =>
    (current?.nominees ?? []).map((n) => ({
      key: n.id,
      name: n.name,
      relation: n.relation,
      dateOfBirth: n.dateOfBirth ?? "",
      share: String(Number(n.sharePercent)),
    }));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NomineeRow[]>(fromCard);
  const [scheme, setScheme] = useState(current?.scheme ?? "pf_and_gratuity");
  const [from, setFrom] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = shareTotal(rows);
  const valid = rows.length > 0 && total === 100 && rows.every((r) => r.name.trim());
  const set = (key: string, patch: Partial<NomineeRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    setBusy(true);
    try {
      await saveNomination(card.id, {
        scheme,
        effectiveFrom: from,
        nominees: rows.map((r) => ({
          name: r.name.trim(),
          relation: r.relation,
          dateOfBirth: r.dateOfBirth || null,
          sharePercent: Number(r.share),
        })),
      });
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err, "The nomination couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="edit-nominees"
        onClick={() => {
          setRows(fromCard());
          setFrom(todayIso());
          setError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        {current ? "Change nominees" : "Add nominees"}
      </button>
    );
  }

  return (
    <section
      data-testid="nominee-editor"
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-card-title font-semibold tracking-card-title">New nomination</h3>
        <span
          data-testid="nominee-total"
          aria-live="polite"
          className={`ml-auto text-sm font-medium ${total === 100 ? "text-success" : "text-destructive"}`}
        >
          {total === 100 ? "Shares total 100%" : `Shares total ${total}%, must be 100`}
        </span>
      </div>
      <div className="mt-3 grid gap-2 @min-[640px]/app:grid-cols-2">
        <label className="min-w-0 text-sm">
          <span className={eyebrow}>Scheme</span>
          <select
            value={scheme}
            onChange={(e) => setScheme(e.target.value)}
            className={`mt-1 ${input}`}
          >
            {NOMINATION_SCHEMES.map((s) => (
              <option key={s} value={s}>
                {s === "pf_and_gratuity" ? "PF and gratuity" : humanise(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          <span className={eyebrow}>Effective from</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={`mt-1 ${input}`}
          />
        </label>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li
            key={r.key}
            data-testid="nominee-editor-row"
            className="grid gap-2 rounded-lg border border-border p-3 @min-[720px]/app:grid-cols-[1fr_9rem_10rem_6rem_auto] @min-[720px]/app:items-end"
          >
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Name</span>
              <input
                aria-label={`Nominee name, row ${i + 1}`}
                value={r.name}
                onChange={(e) => set(r.key, { name: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Relation</span>
              <select
                value={r.relation}
                onChange={(e) => set(r.key, { relation: e.target.value })}
                className={`mt-1 ${input}`}
              >
                {RELATIONS.map((rel) => (
                  <option key={rel} value={rel}>
                    {humanise(rel)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Date of birth</span>
              <input
                type="date"
                value={r.dateOfBirth}
                onChange={(e) => set(r.key, { dateOfBirth: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="min-w-0 text-sm">
              <span className={eyebrow}>Share %</span>
              <input
                aria-label={`Share, row ${i + 1}`}
                inputMode="decimal"
                value={r.share}
                onChange={(e) => set(r.key, { share: e.target.value })}
                className={`mt-1 ${input} font-mono`}
              />
            </label>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              className="h-11 rounded-md border border-border px-3 text-sm"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="nominee-add-row"
        onClick={() =>
          setRows((rs) => [
            ...rs,
            { key: newKey(), name: "", relation: "wife", dateOfBirth: "", share: "" },
          ])
        }
        className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
      >
        Add a nominee
      </button>
      <p className="mt-3 text-caption text-muted-foreground">
        Saving archives the current nomination rather than overwriting it. The superseded form is
        what a claim is settled against, so it stays on the record.
      </p>
      {error && (
        <p role="alert" data-testid="nominee-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !valid}
          data-testid="nominee-save"
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
        >
          {busy ? "Saving…" : "Save nomination"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 rounded-md border border-border px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════ dialogs

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <label className="min-w-0 text-sm">
      <span className={eyebrow}>{label}</span>
      <span className="mt-1 block">{children}</span>
      {error && (
        <span role="alert" className="mt-1 block text-sm text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

export function AddAddressDialog({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const [open, setOpen] = useState(false);
  const blank = {
    addressType: "present",
    effectiveFrom: todayIso(),
    line: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    nearestPoliceStation: "",
    alsoPermanent: false,
  };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const openRow = card.addresses?.find((a) => a.addressType === v.addressType && !a.effectiveTo);
  const openPermanent = card.addresses?.find(
    (a) => a.addressType === "permanent" && !a.effectiveTo,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDateError("");
    setBusy(true);
    try {
      await addAddress(card.id, {
        ...v,
        alsoPermanent: v.addressType === "present" && v.alsoPermanent,
      });
      setOpen(false);
      await onChanged();
    } catch (err) {
      const msg = errorText(err, "The address couldn't be saved.");
      // The bundle's 409: the message belongs on the date field.
      if (isAppError(err) && String(err.details?.code ?? "").includes("EFFECTIVE_DATE_CLASH")) {
        setDateError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="add-address"
        onClick={() => {
          setV(blank);
          setError("");
          setDateError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        Add an address
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add an address</DialogTitle>
            <DialogDescription data-testid="address-what-happens">
              {openRow
                ? `Saving this closes the ${humanise(openRow.addressType).toLowerCase()} address dated ${formatDate(openRow.effectiveFrom)} with an end date of the day before the new one starts. That row stays on the record permanently.`
                : `There is no ${humanise(v.addressType).toLowerCase()} address on record, so nothing is closed.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Address type">
              <select
                data-testid="address-type"
                value={v.addressType}
                onChange={(e) => setV({ ...v, addressType: e.target.value })}
                className={input}
              >
                {ADDRESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanise(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective from" error={dateError}>
              <input
                type="date"
                required
                data-testid="address-from"
                value={v.effectiveFrom}
                onChange={(e) => {
                  setV({ ...v, effectiveFrom: e.target.value });
                  setDateError("");
                }}
                className={input}
              />
            </Field>
            <Field label="Address">
              <input
                required
                data-testid="address-line"
                value={v.line}
                onChange={(e) => setV({ ...v, line: e.target.value })}
                className={input}
              />
            </Field>
            <div className="grid gap-3 @min-[480px]/app:grid-cols-2">
              <Field label="City">
                <input
                  required
                  data-testid="address-city"
                  value={v.city}
                  onChange={(e) => setV({ ...v, city: e.target.value })}
                  className={input}
                />
              </Field>
              <Field label="District">
                <input
                  value={v.district}
                  onChange={(e) => setV({ ...v, district: e.target.value })}
                  className={input}
                />
              </Field>
              <Field label="State">
                <input
                  required
                  data-testid="address-state"
                  value={v.state}
                  onChange={(e) => setV({ ...v, state: e.target.value })}
                  className={input}
                />
              </Field>
              <Field label="Pincode">
                <input
                  required
                  inputMode="numeric"
                  pattern="[1-9][0-9]{5}"
                  data-testid="address-pincode"
                  value={v.pincode}
                  onChange={(e) => setV({ ...v, pincode: e.target.value })}
                  className={input}
                />
              </Field>
            </div>
            <Field label="Nearest police station">
              <input
                value={v.nearestPoliceStation}
                onChange={(e) => setV({ ...v, nearestPoliceStation: e.target.value })}
                className={input}
              />
            </Field>
            {v.addressType === "present" && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v.alsoPermanent}
                  onChange={(e) => setV({ ...v, alsoPermanent: e.target.checked })}
                  className="mt-0.5 size-4"
                />
                <span>
                  This is also the permanent address
                  {openPermanent && (
                    <span className="block text-caption text-muted-foreground">
                      Closes the permanent address dated {formatDate(openPermanent.effectiveFrom)}{" "}
                      the same way.
                    </span>
                  )}
                </span>
              </label>
            )}
            {error && (
              <p role="alert" data-testid="address-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              data-testid="address-save"
              className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              {busy ? "Saving…" : openRow ? "Save and archive the old one" : "Save address"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MoveUnitDialog({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<Option[] | null>(null);
  const blank = {
    unitId: "",
    effectiveFrom: todayIso(),
    orderRef: "",
    expectedDuration: "",
    reason: "",
  };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const currentUnit = card.currentDeployment;

  useEffect(() => {
    if (!open) return;
    listActiveUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDateError("");
    setBusy(true);
    try {
      await moveUnit(card.id, v);
      setOpen(false);
      await onChanged();
    } catch (err) {
      const msg = errorText(err, "The move couldn't be saved.");
      if (isAppError(err) && String(err.details?.code ?? "").includes("EFFECTIVE_DATE_CLASH"))
        setDateError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  // Where they are now is not somewhere they can be moved to.
  const choices = (units ?? []).filter((u) => u.id !== currentUnit?.unitId);

  return (
    <>
      <button
        type="button"
        data-testid="move-unit"
        onClick={() => {
          setV(blank);
          setError("");
          setDateError("");
          setOpen(true);
        }}
        className="h-11 w-fit rounded-md border border-border px-4 text-sm font-medium"
      >
        {currentUnit ? "Move to another unit" : "Deploy to a unit"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{currentUnit ? "Move to another unit" : "Deploy to a unit"}</DialogTitle>
            <DialogDescription data-testid="move-what-happens">
              {currentUnit
                ? `Currently at ${currentUnit.unitName} since ${formatDate(currentUnit.effectiveFrom)}. That posting is closed the day before the new one starts, not edited.`
                : "No current posting, so nothing is closed."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Move to">
              {/* A select from the database's active units. There is no text
                  path to a unit anywhere (criterion 4). */}
              <select
                required
                data-testid="move-unit-select"
                value={v.unitId}
                onChange={(e) => setV({ ...v, unitId: e.target.value })}
                className={input}
              >
                <option value="">
                  {units === null
                    ? "Loading units…"
                    : choices.length
                      ? "Choose a unit"
                      : "No other active unit"}
                </option>
                {choices.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.detail ? `${u.name} (${u.detail})` : u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective from" error={dateError}>
              <input
                type="date"
                required
                data-testid="move-from"
                value={v.effectiveFrom}
                onChange={(e) => {
                  setV({ ...v, effectiveFrom: e.target.value });
                  setDateError("");
                }}
                className={input}
              />
            </Field>
            <Field label="Deployment order reference">
              <input
                required
                data-testid="move-order-ref"
                value={v.orderRef}
                onChange={(e) => setV({ ...v, orderRef: e.target.value })}
                className={`${input} font-mono`}
              />
            </Field>
            <Field label="Expected duration">
              <input
                value={v.expectedDuration}
                placeholder="6 months"
                onChange={(e) => setV({ ...v, expectedDuration: e.target.value })}
                className={input}
              />
            </Field>
            <Field label="Reason">
              <input
                value={v.reason}
                onChange={(e) => setV({ ...v, reason: e.target.value })}
                className={input}
              />
            </Field>
            {error && (
              <p role="alert" data-testid="move-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !v.unitId}
              data-testid="move-save"
              className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              {busy ? "Saving…" : currentUnit ? "Close the current posting and move" : "Deploy"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

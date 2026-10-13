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
  attachAddressProof,
  listActiveUnits,
  moveUnit,
  saveFamily,
  saveNomination,
  savePreviousOrgs,
  updateEmployee,
  type Option,
} from "../handlers";
import { describeWeek, familySummary, formatDate, humanise, shareTotal, todayIso } from "../format";
import { checkField } from "../fieldRules";
import { FieldEditor, type FieldSpec } from "./FieldEditor";
import {
  addDepartmentChoice,
  addDesignationChoice,
  addManagerChoice,
  usePositionLists,
} from "../positionLists";

type Changed = () => Promise<void> | void;

const input = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const eyebrow = "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";

function errorText(err: unknown, fallback: string) {
  return isAppError(err) ? err.message : fallback;
}

// ═══════════════════════════════════════════════════════════ own fields

/**
 * One editor per panel, for the panel's header (D103): "Add …" while the panel
 * has nothing in it, "Edit …" once it has.
 */
function RecordFieldEditor({
  card,
  id,
  title,
  fields,
  filled,
  onChanged,
}: {
  card: EmployeeCard;
  id: string;
  title: string;
  fields: FieldSpec[];
  filled: boolean;
  onChanged: Changed;
}) {
  return (
    <FieldEditor
      id={id}
      title={title}
      filled={filled}
      fields={fields.map((f) => ({ clearable: true, ...f }))}
      save={(vals) => updateEmployee(card.id, vals)}
      onSaved={onChanged}
    />
  );
}

const any = (...values: unknown[]) => values.some((v) => v !== null && v !== undefined && v !== "");

export function ContactEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <RecordFieldEditor
      card={card}
      id="contact"
      title="Contact"
      filled={any(card.mobile, card.alternateMobile, card.personalEmail)}
      onChanged={onChanged}
      fields={[
        {
          key: "mobile",
          label: "Mobile",
          current: card.mobile,
          inputMode: "tel",
          rule: "phone",
          maxLength: 20,
        },
        {
          key: "alternateMobile",
          label: "Alternate mobile",
          current: card.alternateMobile,
          inputMode: "tel",
          rule: "phone",
          maxLength: 20,
        },
        ...("personalEmail" in card
          ? [
              {
                key: "personalEmail",
                label: "Personal email",
                current: card.personalEmail,
                inputMode: "email" as const,
                rule: "email" as const,
                maxLength: 200,
              },
            ]
          : []),
      ]}
    />
  );
}

export function EmergencyEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const ec = card.emergencyContact;
  return (
    <RecordFieldEditor
      card={card}
      id="emergency"
      title="Emergency contact"
      filled={any(ec?.name, ec?.relation, ec?.phone)}
      onChanged={onChanged}
      fields={[
        {
          key: "emergencyContactName",
          label: "Name",
          current: ec?.name,
          rule: "name",
          maxLength: 100,
        },
        {
          key: "emergencyContactRelation",
          label: "Relation",
          current: ec?.relation,
          rule: "words",
          maxLength: 60,
        },
        {
          key: "emergencyContactPhone",
          label: "Phone",
          current: ec?.phone,
          inputMode: "tel",
          rule: "phone",
          maxLength: 20,
        },
      ]}
    />
  );
}

export function IdentityEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <RecordFieldEditor
      card={card}
      id="identity"
      title="Identity"
      filled={any(
        card.fullName,
        card.nameAsPerId,
        card.sex,
        card.dateOfBirth,
        card.maritalStatus,
        card.nationality,
        card.nativeState,
      )}
      onChanged={onChanged}
      fields={[
        {
          key: "fullName",
          label: "Full name",
          current: card.fullName,
          rule: "name",
          required: true,
          maxLength: 100,
        },
        {
          key: "nameAsPerId",
          label: "Name as printed on ID",
          current: card.nameAsPerId,
          rule: "name",
          maxLength: 100,
        },
        { key: "sex", label: "Sex", kind: "select", options: SEXES, current: card.sex },
        {
          key: "dateOfBirth",
          label: "Date of birth",
          kind: "date",
          current: card.dateOfBirth,
          rule: "dateOfBirth",
        },
        {
          key: "maritalStatus",
          label: "Marital status",
          kind: "select",
          options: MARITAL_STATUSES,
          current: card.maritalStatus,
        },
        {
          key: "nationality",
          label: "Nationality",
          current: card.nationality,
          rule: "words",
          maxLength: 60,
        },
        {
          key: "nativeState",
          label: "Native state",
          current: card.nativeState,
          rule: "words",
          maxLength: 60,
        },
      ]}
    />
  );
}

export function EducationEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <RecordFieldEditor
      card={card}
      id="education"
      title="Education"
      filled={any(card.educationQualification, card.reasonForLeavingLastOrg)}
      onChanged={onChanged}
      fields={[
        {
          key: "educationQualification",
          label: "Qualification",
          current: card.educationQualification,
          rule: "text200",
          maxLength: 200,
        },
        {
          key: "reasonForLeavingLastOrg",
          label: "Reason for leaving last org",
          current: card.reasonForLeavingLastOrg,
          rule: "text500",
          maxLength: 500,
        },
      ]}
    />
  );
}

export function PhysicalEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <RecordFieldEditor
      card={card}
      id="physical"
      title="Physical record"
      filled={any(
        card.physical?.heightCm,
        card.physical?.chestCm,
        card.physical?.weightKg,
        card.bloodGroup,
      )}
      onChanged={onChanged}
      fields={[
        {
          key: "heightCm",
          label: "Height (cm)",
          current: card.physical?.heightCm?.toString(),
          inputMode: "numeric",
          rule: "heightCm",
          maxLength: 3,
        },
        {
          key: "chestCm",
          label: "Chest (cm)",
          current: card.physical?.chestCm?.toString(),
          inputMode: "numeric",
          rule: "chestCm",
          maxLength: 3,
        },
        {
          key: "weightKg",
          label: "Weight (kg)",
          current: card.physical?.weightKg?.toString(),
          inputMode: "numeric",
          rule: "weightKg",
          maxLength: 3,
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
          rule: "text100",
          maxLength: 100,
        },
      ]}
    />
  );
}

export function PositionEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const lists = usePositionLists();
  // The current designation stays selectable even if it has since been
  // retired, so the select never shows a different value from the record's.
  const current = card.designation;
  const designations: [string, string][] = lists.designations.map((d) => [
    d.id,
    d.detail ? `${d.name} (${d.detail})` : d.name,
  ]);
  if (current && !designations.some(([id]) => id === current.id)) {
    designations.unshift([current.id, `${current.name} (retired)`]);
  }
  const departments: [string, string][] = lists.departments.map((d) => [d.id, d.name]);
  if (card.department && !departments.some(([id]) => id === card.department!.id)) {
    departments.unshift([card.department.id, card.department.name]);
  }
  const managers: [string, string][] = lists.managers.map((m) => [m.profileId, m.fullName]);
  const mgr = card.reportsTo;
  if (mgr?.profileId && !managers.some(([id]) => id === mgr.profileId)) {
    managers.unshift([mgr.profileId, mgr.fullName ?? "Current manager"]);
  }

  return (
    <RecordFieldEditor
      card={card}
      id="position"
      title="Position"
      filled={any(
        card.employeeCode,
        card.designation,
        card.department,
        card.employmentType,
        card.reportsTo,
      )}
      onChanged={onChanged}
      fields={[
        {
          key: "employeeCode",
          label: "Employee code",
          current: card.employeeCode,
          rule: "employeeCode",
          maxLength: 30,
        },
        {
          key: "designationId",
          label: "Designation",
          kind: "select",
          labelled: designations,
          current: current?.id,
          emptyLabel: "None",
          add: addDesignationChoice,
        },
        {
          key: "departmentId",
          label: "Department",
          kind: "select",
          labelled: departments,
          current: card.department?.id,
          emptyLabel: "None",
          add: addDepartmentChoice,
        },
        ...("employmentType" in card
          ? [
              {
                key: "employmentType",
                label: "Employment type",
                kind: "select" as const,
                labelled: EMPLOYMENT_TYPES.map((t) => [t, EMPLOYMENT_TYPE_LABEL[t]] as const),
                current: card.employmentType,
                emptyLabel: "None",
              },
            ]
          : []),
        {
          key: "managerId",
          label: "Reports to",
          kind: "select",
          labelled: managers,
          current: mgr?.profileId,
          emptyLabel: "None",
          add: addManagerChoice,
        },
      ]}
    />
  );
}

export function DatesEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <RecordFieldEditor
      card={card}
      id="dates"
      title="Dates and status"
      filled
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
          rule: "text500",
          maxLength: 500,
        },
      ]}
    />
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

const blankRelative = (): FamilyRow => ({
  key: newKey(),
  relation: "son",
  name: "",
  dateOfBirth: "",
  isDependent: true,
});

/** The first thing wrong with a relative's row, in words, or null. */
function relativeProblem(name: string, dateOfBirth: string): string | null {
  if (!name.trim()) return "Every row needs a name, or remove it.";
  const n = checkField("name", name);
  if (n) return `${name.trim()}: ${n}`;
  if (dateOfBirth && checkField("pastDate", dateOfBirth)) {
    return `${name.trim()}: the date of birth is in the future.`;
  }
  return null;
}

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
    const wrong = rows.map((r) => relativeProblem(r.name, r.dateOfBirth)).find(Boolean);
    if (wrong) {
      setError(wrong);
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

  const filled = (card.familyMembers ?? []).length > 0;
  return (
    <>
      <button
        type="button"
        data-testid="edit-family"
        onClick={() => {
          setRows(filled ? fromCard() : [blankRelative()]);
          setError("");
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {filled ? "Edit family" : "Add family"}
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-3xl">
          <section data-testid="family-editor">
            <div className="flex flex-wrap items-baseline gap-2 pr-8">
              <DialogTitle>{filled ? "Edit family" : "Add family"}</DialogTitle>
              <DialogDescription className="sr-only">
                Every relative, in any order. Saving replaces the list.
              </DialogDescription>
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
                  className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[9rem_1fr_10rem_auto_auto] md:items-end"
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
              onClick={() => setRows((rs) => [...rs, blankRelative()])}
              className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
            >
              Add a relative
            </button>
            <p className="mt-3 text-caption text-muted-foreground">
              There is no Son 1 and Son 2. Add as many sons, daughters or other relatives as the
              person actually has, in any order.
            </p>
            {error && (
              <p
                role="alert"
                data-testid="family-editor-error"
                className="mt-2 text-sm text-destructive"
              >
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
        </DialogContent>
      </Dialog>
    </>
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

const blankPrevious = (): PrevRow => ({
  key: newKey(),
  organisationName: "",
  designation: "",
  fromDate: "",
  toDate: "",
  reasonForLeaving: "",
});

/** The first thing wrong with a previous job's row, in words, or null. */
function previousProblem(r: PrevRow): string | null {
  if (!r.organisationName.trim() || !r.fromDate || !r.toDate) {
    return "Every row needs an organisation and both dates, or remove it.";
  }
  const who = r.organisationName.trim();
  if (checkField("text200", r.organisationName)) return `${who}: keep the name to 200 characters.`;
  if (checkField("text100", r.designation))
    return `${who}: keep the designation to 100 characters.`;
  if (checkField("pastDate", r.fromDate) || checkField("pastDate", r.toDate)) {
    return `${who}: the dates can't be in the future.`;
  }
  if (r.toDate < r.fromDate) return `${who}: To can't be before From.`;
  if (checkField("text500", r.reasonForLeaving))
    return `${who}: keep the reason to 500 characters.`;
  return null;
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
    const wrong = rows.map(previousProblem).find(Boolean);
    if (wrong) {
      setError(wrong);
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

  const filled = (card.previousOrganisations ?? []).length > 0;
  const title = filled ? "Edit previous organisations" : "Add previous organisations";
  return (
    <>
      <button
        type="button"
        data-testid="edit-previous-orgs"
        onClick={() => {
          setRows(filled ? fromCard() : [blankPrevious()]);
          setError("");
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {title}
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-3xl">
          <section data-testid="previous-orgs-editor">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="mt-1">
              Total experience is worked out from these rows. Saving replaces the list.
            </DialogDescription>
            <ul className="mt-3 flex flex-col gap-3">
              {rows.map((r, i) => (
                <li
                  key={r.key}
                  className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-2"
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
                  <label className="min-w-0 text-sm md:col-span-2">
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
              onClick={() => setRows((rs) => [...rs, blankPrevious()])}
              className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
            >
              Add an organisation
            </button>
            {error && (
              <p
                role="alert"
                data-testid="previous-orgs-error"
                className="mt-2 text-sm text-destructive"
              >
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
        </DialogContent>
      </Dialog>
    </>
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
    const wrong = rows.map((r) => relativeProblem(r.name, r.dateOfBirth)).find(Boolean);
    if (wrong) {
      setError(wrong);
      return;
    }
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

  return (
    <>
      <button
        type="button"
        data-testid="edit-nominees"
        onClick={() => {
          setRows(fromCard());
          setFrom(todayIso());
          setError("");
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {current ? "Change nominees" : "Add nominees"}
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-3xl">
          <section data-testid="nominee-editor">
            <div className="flex flex-wrap items-baseline gap-2 pr-8">
              <DialogTitle>New nomination</DialogTitle>
              <DialogDescription className="sr-only">
                Saving archives the current nomination rather than overwriting it.
              </DialogDescription>
              <span
                data-testid="nominee-total"
                aria-live="polite"
                className={`ml-auto text-sm font-medium ${total === 100 ? "text-success" : "text-destructive"}`}
              >
                {total === 100 ? "Shares total 100%" : `Shares total ${total}%, must be 100`}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                  className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_9rem_10rem_6rem_auto] md:items-end"
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
              Saving archives the current nomination rather than overwriting it. The superseded form
              is what a claim is settled against, so it stays on the record.
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
        </DialogContent>
      </Dialog>
    </>
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

/** The first thing wrong with an address, in words, or null. The database checks again. */
function addressProblem(v: {
  line: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  nearestPoliceStation: string;
}): string | null {
  if (!v.line.trim()) return "Address: say the house, street and area.";
  if (v.line.trim().length > 300) return "Address: keep it to 300 characters.";
  if (!v.city.trim()) return "City is required.";
  for (const [label, value] of [
    ["City", v.city],
    ["District", v.district],
    ["State", v.state],
  ] as const) {
    const p = checkField("words", value);
    if (p) return `${label}: ${p}`;
  }
  if (!v.state.trim()) return "State is required.";
  const pin = checkField("pincode", v.pincode);
  if (!v.pincode.trim() || pin) return pin ?? "A pincode is 6 digits and doesn't start with 0.";
  const ps = checkField("text100", v.nearestPoliceStation);
  if (ps) return `Nearest police station: ${ps}`;
  return null;
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
  // D98: the proof, filed against the row added for the type chosen.
  const [proof, setProof] = useState<File | null>(null);
  const [proofFailed, setProofFailed] = useState(false);
  const openRow = card.addresses?.find((a) => a.addressType === v.addressType && !a.effectiveTo);
  const openPermanent = card.addresses?.find(
    (a) => a.addressType === "permanent" && !a.effectiveTo,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDateError("");
    const wrong = addressProblem(v);
    if (wrong) {
      setError(wrong);
      return;
    }
    setBusy(true);
    try {
      const added = await addAddress(card.id, {
        ...v,
        alsoPermanent: v.addressType === "present" && v.alsoPermanent,
      });
      const row = added.find((a) => a.addressType === v.addressType);
      if (proof && row) {
        // The address is saved whatever happens to the file; a proof that
        // fails is attached afterwards from the row, never by saving again.
        try {
          await attachAddressProof({ employeeId: card.id, addressId: row.id, file: proof });
        } catch {
          setProofFailed(true);
        }
      }
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
          setProof(null);
          setProofFailed(false);
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        Add an address
      </button>
      {proofFailed && (
        <p role="alert" data-testid="address-proof-failed" className="text-sm text-destructive">
          The address was saved, but the proof didn&apos;t attach. Attach it from the address row.
        </p>
      )}
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
          <form onSubmit={submit} noValidate className="grid gap-3">
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
            <Field label="Proof (optional)">
              <input
                type="file"
                aria-label="Proof (optional)"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              <span className="mt-1 block text-caption text-muted-foreground">
                A rent agreement, a utility bill or an ID showing this address. PDF or a photo, up
                to 10 MB.
              </span>
            </Field>
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
  // D102: a person's own shift ends at the move unless the Admin keeps it.
  const ownShift = card.workPattern?.shiftSource === "person" ? card.workPattern.shift : null;
  const [keepOwnShift, setKeepOwnShift] = useState(false);

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
      await moveUnit(card.id, ownShift ? { ...v, keepOwnShift } : v);
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
  const chosen = choices.find((u) => u.id === v.unitId);

  return (
    <>
      <button
        type="button"
        data-testid="move-unit"
        onClick={() => {
          setV(blank);
          setError("");
          setDateError("");
          setKeepOwnShift(false);
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
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
            {chosen?.calendar && v.effectiveFrom && (
              <p
                data-testid="move-calendar-note"
                className="rounded-lg border border-info-line bg-info-muted px-3 py-2 text-sm"
              >
                From {formatDate(v.effectiveFrom)} their leave is counted on {chosen.calendar.name}:{" "}
                {describeWeek(chosen.calendar.weeklyOff)}.
              </p>
            )}
            {ownShift && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Keep their own shift (${ownShift.name})`}
                  checked={keepOwnShift}
                  onChange={(e) => setKeepOwnShift(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  Keep their own shift ({ownShift.name})
                  <span className="block text-caption text-muted-foreground">
                    Unticked, they work the new unit&apos;s shift from the move.
                  </span>
                </span>
              </label>
            )}
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

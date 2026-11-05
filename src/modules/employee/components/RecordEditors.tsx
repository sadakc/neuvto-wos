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

import { LabelText } from "@/components/shared/required";
import { emptyMessage } from "@/lib/required";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/shared/date-field";
import { DATE_FORMAT_MESSAGE, isIsoDate } from "@/components/shared/date-rules";
import { FilePicker } from "@/components/shared/file-picker";
import { isAppError } from "@/platform/errors";
import {
  ADDRESS_TYPES,
  BLOOD_GROUPS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  MARITAL_STATUSES,
  NATIONALITIES,
  RELATIONS,
  SEXES,
  type EmployeeCard,
  type PreviousOrganisation,
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
  withdrawPosting,
  type MoveInput,
  type Option,
} from "../handlers";
import {
  describeWeek,
  durationText,
  familySummary,
  formatDate,
  formatMonths,
  humanise,
  shareTotal,
  todayIso,
} from "../format";
import { checkField, LIMITS } from "../fieldRules";
import { canWrite, fieldsFor, isRequired, relationField } from "../fieldSettings";
import { FieldEditor, type FieldSpec } from "./FieldEditor";
import {
  addDepartmentChoice,
  addDesignationChoice,
  addManagerChoice,
  addUnitChoice,
  usePositionLists,
} from "../positionLists";
import { AddInline } from "./FieldEditor";
import { districtsOf, HOME_STATE, STATES } from "../indiaPlaces";

type Changed = () => Promise<void> | void;

const input = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const eyebrow = "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";

function errorText(err: unknown, fallback: string) {
  return isAppError(err) ? err.message : fallback;
}

/** The same day `years` ago, ISO: where a date of birth's calendar opens, and its latest. */
function yearsAgo(years: number) {
  const t = new Date();
  const d = new Date(t.getFullYear() - years, t.getMonth(), t.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A relation as the list spells it. One typed before the list existed
 * ("Sister") is matched to it; anything else is kept as it was, so the select
 * still shows what is on record.
 */
function asRelation(v: string | null | undefined) {
  if (!v) return v;
  return RELATIONS.find((r) => r === v.trim().toLowerCase()) ?? v;
}

/** The dropdowns' ranges (D104). The database allows a wider range; a value outside these is still shown. */
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
// From 4 ft (122 cm), Sada's floor (D105), to 6 ft 6 in (198 cm), his ceiling (D117).
const HEIGHTS = range(122, 198).map((cm) => {
  const inches = Math.round(cm / 2.54);
  return [String(cm), `${cm} cm (${Math.floor(inches / 12)}′ ${inches % 12}″)`] as const;
});
// What an Indian workforce measures (Sada, 3 Nov 2026).
const CHESTS = range(60, 130).map((cm) => [String(cm), `${cm} cm`] as const);
const WEIGHTS = range(30, 150).map((kg) => [String(kg), `${kg} kg`] as const);

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
      fields={fieldsFor(
        card,
        fields.map((f) => ({ clearable: true, ...f })),
      )}
      save={(vals) => updateEmployee(card.id, vals)}
      onSaved={onChanged}
    />
  );
}

const any = (...values: unknown[]) => values.some((v) => v !== null && v !== undefined && v !== "");

/**
 * D121: the police station is the present address's. Said where it is edited,
 * so a correction here is not a surprise on the address.
 */
function policeStationHint(card: EmployeeCard): string | undefined {
  if (!card.addresses) return undefined;
  const present = card.addresses.find((a) => a.addressType === "present" && !a.effectiveTo);
  return present
    ? `The present address's (${present.line}): a correction here is a correction there.`
    : "Kept here until a present address is added, which then takes it.";
}

/** The last organisation left: the latest end, then the latest start (D121). */
function latestPreviousOrg(card: EmployeeCard): PreviousOrganisation | undefined {
  return [...(card.previousOrganisations ?? [])].sort(
    (a, b) => b.toDate.localeCompare(a.toDate) || b.fromDate.localeCompare(a.fromDate),
  )[0];
}

/** D121: the reason is the latest organisation's too; said where it is typed. */
function reasonHint(card: EmployeeCard): string | undefined {
  const last = latestPreviousOrg(card);
  return last
    ? `Also the reason on ${last.organisationName}, in Previous organisations.`
    : undefined;
}

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

const FROM_FAMILY = "emergencyContactFamilyMemberId";

export function EmergencyEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const ec = card.emergencyContact;
  // D121: somebody already in Family is picked, not typed again; their name
  // and relation then follow Family. Only the phone is typed: Family keeps none.
  const family = card.familyMembers ?? [];
  const member = (id: string) => family.find((m) => m.id === id);
  const own = (vals: Record<string, string>) => !vals[FROM_FAMILY];
  return (
    <RecordFieldEditor
      card={card}
      id="emergency"
      title="Emergency contact"
      filled={any(ec?.name, ec?.relation, ec?.phone)}
      onChanged={onChanged}
      fields={[
        ...(family.length > 0
          ? [
              {
                key: FROM_FAMILY,
                label: "Who",
                kind: "select" as const,
                labelled: family.map((m) => [m.id, `${m.name} (${humanise(m.relation)})`] as const),
                current: ec?.familyMemberId,
                emptyLabel: "Somebody not in Family",
              },
              {
                key: "emergencyFromFamily",
                label: "Name and relation",
                kind: "derived" as const,
                when: (vals: Record<string, string>) => !own(vals),
                derive: (vals: Record<string, string>) => {
                  const m = member(vals[FROM_FAMILY]);
                  return m ? `${m.name}, ${humanise(m.relation).toLowerCase()}: from Family` : "—";
                },
              },
            ]
          : []),
        {
          key: "emergencyContactName",
          label: "Name",
          current: ec?.name,
          rule: "name",
          maxLength: LIMITS.name,
          when: own,
        },
        {
          key: "emergencyContactRelation",
          label: "Relation",
          kind: "select",
          options: RELATIONS,
          current: asRelation(ec?.relation),
          emptyLabel: "Select",
          when: own,
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
          rule: "fullName",
          required: true,
          maxLength: LIMITS.fullName,
        },
        {
          key: "nameAsPerId",
          label: "Name as printed on ID",
          current: card.nameAsPerId,
          rule: "fullName",
          maxLength: LIMITS.fullName,
        },
        { key: "sex", label: "Sex", kind: "select", options: SEXES, current: card.sex },
        {
          key: "dateOfBirth",
          label: "Date of birth",
          kind: "date",
          current: card.dateOfBirth,
          rule: "dateOfBirth",
          min: "1900-01-02",
          max: yearsAgo(14),
          openAt: yearsAgo(30),
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
          kind: "select",
          labelled: NATIONALITIES.map((n) => [n, n] as const),
          current: card.nationality,
          defaultValue: "Indian",
        },
        {
          key: "nativeState",
          label: "Native state",
          kind: "select",
          labelled: STATES.map((st) => [st, st] as const),
          current: card.nativeState,
          defaultValue: HOME_STATE,
        },
      ]}
    />
  );
}

export function EducationEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <FieldEditor
      id="education"
      title="Education and experience"
      // The panel's own title says what it edits; the button says only how (D104).
      label={
        any(card.educationQualification, card.reasonForLeavingLastOrg, card.priorExperienceMonths)
          ? "Edit"
          : "Add"
      }
      accessibleLabel={`${
        any(card.educationQualification, card.reasonForLeavingLastOrg, card.priorExperienceMonths)
          ? "Edit"
          : "Add"
      } education and experience`}
      filled={any(
        card.educationQualification,
        card.reasonForLeavingLastOrg,
        card.priorExperienceMonths,
      )}
      save={(vals) => updateEmployee(card.id, vals)}
      onSaved={onChanged}
      // D107: the person sees only what is theirs to change.
      fields={fieldsFor(
        card,
        [
          {
            key: "educationQualification",
            label: "Qualification",
            current: card.educationQualification,
            rule: "text200",
            maxLength: 200,
          },
          {
            key: "priorExperienceMonths",
            label: "Experience before joining",
            kind: "yearsMonths",
            current: card.priorExperienceMonths?.toString(),
            hint: "Total experience is this plus their service here, and keeps counting by itself.",
          },
          {
            key: "reasonForLeavingLastOrg",
            label: "Reason for leaving last org",
            current: card.reasonForLeavingLastOrg,
            rule: "text500",
            maxLength: 500,
            hint: reasonHint(card),
          },
          {
            key: "totalExperience",
            label: "Total experience now",
            kind: "derived",
            derive: () =>
              card.totalExperienceMonths != null ? formatMonths(card.totalExperienceMonths) : "—",
            hint: "As saved. It updates when you save.",
          },
        ].map((f) => ({ clearable: true, ...f }) as FieldSpec),
      )}
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
          label: "Height",
          kind: "select",
          labelled: HEIGHTS,
          current: card.physical?.heightCm?.toString(),
        },
        {
          key: "chestCm",
          label: "Chest",
          kind: "select",
          labelled: CHESTS,
          current: card.physical?.chestCm?.toString(),
        },
        {
          key: "weightKg",
          label: "Weight",
          kind: "select",
          labelled: WEIGHTS,
          current: card.physical?.weightKg?.toString(),
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
          rule: "text30",
          maxLength: LIMITS.short,
          hint: policeStationHint(card),
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
          key: "grade",
          label: "Grade",
          kind: "derived",
          // The grade belongs to the designation, so it follows the one chosen.
          derive: (vals) => {
            const id = vals.designationId;
            if (!id) return "None";
            if (id === current?.id && !lists.designations.some((d) => d.id === id)) {
              return current?.grade ?? "None";
            }
            return lists.designations.find((d) => d.id === id)?.detail ?? "None";
          },
          hint: "Comes with the designation. Change it in Configuration, Designations.",
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
      title="Joining and exit dates"
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
  // Nothing is assumed (D104): the Admin chooses.
  relation: "",
  name: "",
  dateOfBirth: "",
  isDependent: true,
});

/** The first thing wrong with a relative's row, in words, or null. */
function relativeProblem(name: string, dateOfBirth: string, relation: string): string | null {
  if (!name.trim()) return "Every row needs a name, or remove it.";
  const n = checkField("name", name);
  if (n) return `${name.trim()}: ${n}`;
  if (!relation) return `${name.trim()}: choose a relation.`;
  if (dateOfBirth && !isIsoDate(dateOfBirth)) {
    return `${name.trim()}: ${DATE_FORMAT_MESSAGE}`;
  }
  if (dateOfBirth && checkField("pastDate", dateOfBirth)) {
    return `${name.trim()}: the date of birth is in the future.`;
  }
  return null;
}

/** A name as a person is told apart by: spaces and case do not make two people (D123). */
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Two family members with the same name are one person listed twice (Sada, 4 Nov 2026). */
function sameName(rows: { name: string }[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const k = nameKey(r.name);
    if (!k) continue;
    if (seen.has(k))
      return `${r.name.trim()} is listed twice. Each family member is listed once, with their own name.`;
    seen.add(k);
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
  // D107: the person changes only the relatives their company lets them; the
  // rest are shown, sent back as they are, and cannot be edited or removed.
  const mayRelation = (relation: string) => canWrite(card, relationField(relation));
  const onRecord = new Map((card.familyMembers ?? []).map((f) => [f.id, f.relation]));
  const locked = (r: FamilyRow) => r.id !== undefined && !mayRelation(onRecord.get(r.id) ?? "");
  const relations = RELATIONS.filter(mayRelation);

  const set = (key: string, patch: Partial<FamilyRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    // D117: one father and one mother.
    const twice = ["father", "mother"].find((p) => rows.filter((r) => r.relation === p).length > 1);
    const wrong =
      (twice ? `There can be only one ${twice}. Change the one on record instead.` : null) ??
      rows.map((r) => relativeProblem(r.name, r.dateOfBirth, r.relation)).find(Boolean) ??
      sameName(rows);
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
            <DialogHeader className="flex-row flex-wrap items-baseline gap-2 space-y-0 pr-8 text-left">
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
            </DialogHeader>
            <ul className="mt-3 flex flex-col gap-3">
              {rows.map((r, i) => (
                <li
                  key={r.key}
                  data-testid={locked(r) ? "family-row-locked" : "family-editor-row"}
                  className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[9rem_1fr_11rem_auto_auto] md:items-end"
                >
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>Relation</span>
                    <select
                      aria-label={`Relation, row ${i + 1}`}
                      value={r.relation}
                      disabled={locked(r)}
                      onChange={(e) => set(r.key, { relation: e.target.value })}
                      className={`mt-1 ${input}`}
                    >
                      <option value="" disabled>
                        Select
                      </option>
                      {(locked(r) ? [r.relation] : relations).map((rel) => {
                        // D117, D123: one father and one mother; once a row
                        // has one, no other row can choose it.
                        const taken =
                          (rel === "father" || rel === "mother") &&
                          rows.some((o) => o.key !== r.key && o.relation === rel);
                        return (
                          <option key={rel} value={rel} disabled={taken}>
                            {humanise(rel)}
                            {taken ? " (already added)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>Name</span>
                    <input
                      aria-label={`Name, row ${i + 1}`}
                      maxLength={LIMITS.name}
                      value={r.name}
                      disabled={locked(r)}
                      onChange={(e) => set(r.key, { name: e.target.value })}
                      className={`mt-1 ${input}`}
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>Date of birth</span>
                    {locked(r) ? (
                      <span className={`mt-1 flex items-center ${input} bg-muted/40`}>
                        {formatDate(r.dateOfBirth || null) ?? "—"}
                      </span>
                    ) : (
                      <DateField
                        value={r.dateOfBirth}
                        onChange={(v) => set(r.key, { dateOfBirth: v })}
                        max={todayIso()}
                        label={`Date of birth, row ${i + 1}`}
                        className="mt-1"
                      />
                    )}
                  </label>
                  <label className="flex h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.isDependent}
                      disabled={locked(r)}
                      onChange={(e) => set(r.key, { isDependent: e.target.checked })}
                      className="size-4"
                    />
                    Dependent
                  </label>
                  {locked(r) ? (
                    <span className="text-caption text-muted-foreground md:max-w-[9rem]">
                      Your company keeps this one. Ask with Request a change.
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      aria-label={`Remove row ${i + 1}`}
                      className="h-11 rounded-md border border-border px-3 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              data-testid="family-add-row"
              onClick={() => setRows((rs) => [...rs, blankRelative()])}
              className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
            >
              Add a family member
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
  if (!isIsoDate(r.fromDate) || !isIsoDate(r.toDate)) return `${who}: ${DATE_FORMAT_MESSAGE}`;
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
            <DialogHeader className="text-left">
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="mt-1">
              Total experience is worked out from these rows, unless the experience before joining
              is set on the Personal tab. Saving replaces the list.
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
                      maxLength={LIMITS.short}
                      value={r.organisationName}
                      onChange={(e) => set(r.key, { organisationName: e.target.value })}
                      className={`mt-1 ${input}`}
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>Designation</span>
                    <input
                      maxLength={LIMITS.short}
                      value={r.designation}
                      onChange={(e) => set(r.key, { designation: e.target.value })}
                      className={`mt-1 ${input}`}
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>From</span>
                    <DateField
                      label={`From, row ${i + 1}`}
                      value={r.fromDate}
                      onChange={(v) => set(r.key, { fromDate: v })}
                      max={todayIso()}
                      className="mt-1"
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>To</span>
                    <DateField
                      label={`To, row ${i + 1}`}
                      value={r.toDate}
                      onChange={(v) => set(r.key, { toDate: v })}
                      max={todayIso()}
                      className="mt-1"
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
  /** D117: the family member this nominee is. */
  familyMemberId?: string;
}

/** One of each: picking it as a nominee's relation picks the person (D117). */
const ONE_OF = new Set(["father", "mother"]);

export function NominationEditor({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const current = card.nominations?.find((n) => !n.effectiveTo);
  const fromCard = (): NomineeRow[] =>
    (current?.nominees ?? []).map((n) => ({
      key: n.id,
      name: n.name,
      relation: n.relation,
      dateOfBirth: n.dateOfBirth ?? "",
      share: String(Number(n.sharePercent)),
      familyMemberId: n.familyMemberId ?? undefined,
    }));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NomineeRow[]>(fromCard);
  // D117: a nominee is a family member, one person in one record.
  const family = card.familyMembers ?? [];
  const fromFamily = (f: (typeof family)[number]): Partial<NomineeRow> => ({
    name: f.name,
    relation: f.relation,
    dateOfBirth: f.dateOfBirth ?? "",
    familyMemberId: f.id,
  });
  const notYetNominated = family.filter((f) => !rows.some((r) => r.familyMemberId === f.id));
  /** A relation chosen for a row: a father or mother is the one in Family. */
  const chooseRelation = (row: NomineeRow, relation: string) => {
    const parent = ONE_OF.has(relation) ? family.find((f) => f.relation === relation) : undefined;
    if (parent) set(row.key, fromFamily(parent));
    else {
      const linked = family.find((f) => f.id === row.familyMemberId);
      set(row.key, {
        relation,
        familyMemberId: linked && linked.relation === relation ? linked.id : undefined,
      });
    }
  };
  const [from, setFrom] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = shareTotal(rows);
  const set = (key: string, patch: Partial<NomineeRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    // D113: what is missing is said on pressing Save, never by greying it out.
    const wrong =
      (rows.length === 0 ? "Add at least one nominee." : null) ??
      (rows.some((r) => !r.name.trim()) ? "Every nominee needs a name." : null) ??
      (total !== 100 ? `The shares total ${total}%. They must make 100%.` : null) ??
      (!isIsoDate(from) ? `Effective from: ${DATE_FORMAT_MESSAGE}` : null) ??
      rows.map((r) => relativeProblem(r.name, r.dateOfBirth, r.relation)).find(Boolean) ??
      (isRequired(card, "nomineeDob") && rows.some((r) => !r.dateOfBirth)
        ? "Your company requires every nominee's date of birth."
        : null);
    if (wrong) {
      setError(wrong);
      return;
    }
    setBusy(true);
    try {
      await saveNomination(card.id, {
        effectiveFrom: from,
        nominees: rows.map((r) => ({
          name: r.name.trim(),
          relation: r.relation,
          dateOfBirth: r.dateOfBirth || null,
          sharePercent: Number(r.share),
          familyMemberId: r.familyMemberId ?? null,
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
            <DialogHeader className="flex-row flex-wrap items-baseline gap-2 space-y-0 pr-8 text-left">
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
            </DialogHeader>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="min-w-0 text-sm">
                <span className={eyebrow}>
                  <LabelText required>Effective from</LabelText>
                </span>
                <DateField
                  label="Effective from"
                  value={from}
                  required
                  onChange={setFrom}
                  className="mt-1"
                />
              </label>
            </div>
            <ul className="mt-3 flex flex-col gap-3">
              {rows.map((r, i) => (
                <li
                  key={r.key}
                  data-testid="nominee-editor-row"
                  className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_9rem_11rem_6rem_auto] md:items-end"
                >
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>
                      <LabelText required>Name</LabelText>
                    </span>
                    <input
                      aria-label={`Nominee name, row ${i + 1}`}
                      maxLength={LIMITS.name}
                      aria-required
                      value={r.name}
                      onChange={(e) => set(r.key, { name: e.target.value })}
                      className={`mt-1 ${input}`}
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>Relation</span>
                    <select
                      value={r.relation}
                      onChange={(e) => chooseRelation(r, e.target.value)}
                      className={`mt-1 ${input}`}
                    >
                      <option value="" disabled>
                        Select
                      </option>
                      {RELATIONS.map((rel) => (
                        <option key={rel} value={rel}>
                          {humanise(rel)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>
                      <LabelText required={isRequired(card, "nomineeDob")}>Date of birth</LabelText>
                    </span>
                    <DateField
                      label={`Date of birth, nominee ${i + 1}`}
                      value={r.dateOfBirth}
                      onChange={(v) => set(r.key, { dateOfBirth: v })}
                      max={todayIso()}
                      className="mt-1"
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    <span className={eyebrow}>
                      <LabelText required>Share %</LabelText>
                    </span>
                    <input
                      aria-label={`Share, row ${i + 1}`}
                      aria-required
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
                  { key: newKey(), name: "", relation: "", dateOfBirth: "", share: "" },
                ])
              }
              className="mt-3 h-11 rounded-md border border-dashed border-border px-4 text-sm font-medium"
            >
              Add a nominee
            </button>
            {notYetNominated.length > 0 && (
              <label className="mt-3 block text-sm">
                <span className={eyebrow}>Or add from Family</span>
                <select
                  data-testid="nominee-from-family"
                  value=""
                  onChange={(e) => {
                    const f = family.find((x) => x.id === e.target.value);
                    if (f)
                      setRows((rs) => [
                        ...rs,
                        { key: newKey(), share: "", ...fromFamily(f) } as NomineeRow,
                      ]);
                  }}
                  className={`mt-1 ${input}`}
                >
                  <option value="">Choose a family member</option>
                  {notYetNominated.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({humanise(f.relation)}
                      {f.dateOfBirth ? `, born ${formatDate(f.dateOfBirth)}` : ""})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p data-testid="nominee-is-family" className="mt-3 text-caption text-muted-foreground">
              A nominee is a member of your family. Somebody new is added to Family too, and a name
              or date of birth changed here is changed in Family.
            </p>
            <p className="mt-3 text-caption text-muted-foreground">
              One nomination covers PF, gratuity, ESIC and insurance alike (D105). Saving archives
              the current one rather than overwriting it; the superseded form is what a claim is
              settled against, so it stays on the record. Saving again the same day corrects it.
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
                disabled={busy}
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
  required,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  /** A red asterisk on the label (D113). */
  required?: boolean;
}) {
  return (
    <label className="min-w-0 text-sm">
      <span className={eyebrow}>
        <LabelText required={required}>{label}</LabelText>
      </span>
      <span className="mt-1 block">{children}</span>
      {error && (
        <span role="alert" className="mt-1 block text-sm text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

const OTHER = "__other__";

/** The day after an ISO date. */
function nextDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
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
  if (!v.city.trim()) return "City/Town is required.";
  for (const [label, value] of [
    ["City/Town", v.city],
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

/** The field the company sets for an address type; the other types are the Employee Admin's. */
const ADDRESS_FIELD: Record<string, string> = {
  present: "presentAddress",
  permanent: "permanentAddress",
};

export function AddAddressDialog({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const [open, setOpen] = useState(false);
  // D107: the person adds only the types their company lets them.
  const types = ADDRESS_TYPES.filter(
    (t) => card.capabilities.canEdit || (ADDRESS_FIELD[t] && canWrite(card, ADDRESS_FIELD[t])),
  );
  const blank = {
    addressType: (types[0] ?? "present") as string,
    effectiveFrom: todayIso(),
    line: "",
    city: "",
    district: "",
    state: HOME_STATE,
    pincode: "",
    nearestPoliceStation: "",
    alsoPermanent: false,
  };
  const [v, setV] = useState(blank);
  const [otherDistrict, setOtherDistrict] = useState(false);
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
  // D121: a permanent address the same as the present one is not typed again.
  const openPresent = card.addresses?.find((a) => a.addressType === "present" && !a.effectiveTo);
  const [samePresent, setSamePresent] = useState(false);
  function copyPresent(on: boolean) {
    setSamePresent(on);
    if (!on || !openPresent) {
      setV({
        ...v,
        line: "",
        city: "",
        district: "",
        state: HOME_STATE,
        pincode: "",
        nearestPoliceStation: "",
      });
      setOtherDistrict(false);
      return;
    }
    const district = openPresent.district ?? "";
    setV({
      ...v,
      line: openPresent.line,
      city: openPresent.city,
      district,
      state: openPresent.state,
      pincode: openPresent.pincode,
      nearestPoliceStation: openPresent.nearestPoliceStation ?? "",
    });
    setOtherDistrict(district !== "" && !districtsOf(openPresent.state).includes(district));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDateError("");
    const wrong = isIsoDate(v.effectiveFrom)
      ? addressProblem(v)
      : `Effective from: ${DATE_FORMAT_MESSAGE}`;
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
          setOtherDistrict(false);
          setSamePresent(false);
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
                onChange={(e) => {
                  setV({ ...v, addressType: e.target.value });
                  if (samePresent) copyPresent(false);
                }}
                className={input}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {humanise(t)}
                  </option>
                ))}
              </select>
            </Field>
            {v.addressType === "permanent" && openPresent && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="address-same-as-present"
                  checked={samePresent}
                  onChange={(e) => copyPresent(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  The same as the present address
                  <span className="block text-caption text-muted-foreground">
                    {openPresent.line}, {openPresent.city}: filled in below, to change if it
                    differs.
                  </span>
                </span>
              </label>
            )}
            <Field label="Effective from" error={dateError}>
              <DateField
                label="Effective from"
                required
                testId="address-from"
                value={v.effectiveFrom}
                onChange={(d) => {
                  setV({ ...v, effectiveFrom: d });
                  setDateError("");
                }}
              />
            </Field>
            {/* D105: the state first, as a list; its districts follow it. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="State">
                <select
                  required
                  data-testid="address-state"
                  value={v.state}
                  onChange={(e) => {
                    setV({ ...v, state: e.target.value, district: "" });
                    setOtherDistrict(false);
                  }}
                  className={input}
                >
                  {STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="District">
                <select
                  data-testid="address-district"
                  value={otherDistrict ? OTHER : v.district}
                  onChange={(e) => {
                    const other = e.target.value === OTHER;
                    setOtherDistrict(other);
                    setV({ ...v, district: other ? "" : e.target.value });
                  }}
                  className={input}
                >
                  <option value="">Select</option>
                  {districtsOf(v.state).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  <option value={OTHER}>Not listed: type it</option>
                </select>
              </Field>
            </div>
            {otherDistrict && (
              <Field label="District, as written">
                <input
                  data-testid="address-district-other"
                  maxLength={LIMITS.words}
                  value={v.district}
                  onChange={(e) => setV({ ...v, district: e.target.value })}
                  className={input}
                />
              </Field>
            )}
            <Field label="Address">
              <input
                required
                data-testid="address-line"
                value={v.line}
                placeholder="House, street and area"
                onChange={(e) => setV({ ...v, line: e.target.value })}
                className={input}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="City/Town">
                <input
                  required
                  data-testid="address-city"
                  maxLength={LIMITS.words}
                  value={v.city}
                  onChange={(e) => setV({ ...v, city: e.target.value })}
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
                maxLength={LIMITS.short}
                value={v.nearestPoliceStation}
                onChange={(e) => setV({ ...v, nearestPoliceStation: e.target.value })}
                className={input}
              />
            </Field>
            {v.addressType === "present" && canWrite(card, "permanentAddress") && (
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
            <FilePicker
              label="Proof (optional)"
              file={proof}
              onChange={setProof}
              hint="A rent agreement, a utility bill or an ID showing this address. PDF or a photo, up to 10 MB."
            />
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
    reason: "",
    // D105: the current posting's own last day, and the duration as two lists.
    endsOn: "",
    durationYears: "",
    durationMonths: "",
  };
  const [v, setV] = useState(blank);
  // Once the Admin picks the start themselves, the last day no longer moves it.
  const [startChosen, setStartChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const [endError, setEndError] = useState("");
  const currentUnit = card.currentDeployment;
  // D102: a person's own shift ends at the move unless the Admin keeps it.
  const ownShift = card.workPattern?.shiftSource === "person" ? card.workPattern.shift : null;
  const [keepOwnShift, setKeepOwnShift] = useState(false);
  // D104: a unit that isn't on the list yet is added from here, like a department.
  const [addingUnit, setAddingUnit] = useState(false);

  useEffect(() => {
    if (!open) return;
    listActiveUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, [open]);

  // D113: what is missing is said on pressing the button, under each field,
  // never by greying the button out.
  const [unitError, setUnitError] = useState("");
  const [refError, setRefError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDateError("");
    setEndError("");
    const noUnit = addingUnit
      ? "Add the unit first, or choose one."
      : !v.unitId
        ? emptyMessage(currentUnit ? "Move to" : "Deploy to")
        : "";
    const noRef = v.orderRef.trim() ? "" : emptyMessage("Deployment order reference");
    const noDate = v.effectiveFrom
      ? ""
      : emptyMessage(currentUnit ? "The start" : "Effective from");
    setUnitError(noUnit);
    setRefError(noRef);
    if (noDate) setDateError(noDate);
    if (noUnit || noRef || noDate) return;
    if (v.endsOn && !isIsoDate(v.endsOn)) {
      setEndError(DATE_FORMAT_MESSAGE);
      return;
    }
    if (!isIsoDate(v.effectiveFrom)) {
      setDateError(DATE_FORMAT_MESSAGE);
      return;
    }
    if (currentUnit && v.endsOn && v.endsOn < currentUnit.effectiveFrom) {
      setEndError(`It can't end before it began, on ${formatDate(currentUnit.effectiveFrom)}.`);
      return;
    }
    if (v.endsOn && v.effectiveFrom <= v.endsOn) {
      setDateError(`The new posting has to start after ${formatDate(v.endsOn)}.`);
      return;
    }
    const input: MoveInput = {
      unitId: v.unitId,
      effectiveFrom: v.effectiveFrom,
      orderRef: v.orderRef,
      expectedDuration: durationText(v.durationYears, v.durationMonths),
      reason: v.reason,
      ...(currentUnit && v.endsOn ? { currentEndsOn: v.endsOn } : {}),
      ...(ownShift ? { keepOwnShift } : {}),
    };
    setBusy(true);
    try {
      await moveUnit(card.id, input);
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
          setEndError("");
          setUnitError("");
          setRefError("");
          setStartChosen(false);
          setKeepOwnShift(false);
          setAddingUnit(false);
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
                ? `Currently at ${currentUnit.unitName} since ${formatDate(currentUnit.effectiveFrom)}. That posting is closed, not edited: on the last day you give, or the day before the new one starts.`
                : "No current posting, so nothing is closed."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="grid gap-3">
            <Field label={currentUnit ? "Move to" : "Deploy to"} required error={unitError}>
              {/* A select from the database's active units. There is no text
                  path to a unit anywhere (criterion 4). */}
              <select
                required
                data-testid="move-unit-select"
                value={addingUnit ? "__add__" : v.unitId}
                onChange={(e) => {
                  if (e.target.value === "__add__") {
                    setAddingUnit(true);
                    return;
                  }
                  setAddingUnit(false);
                  setV({ ...v, unitId: e.target.value });
                  setUnitError("");
                }}
                aria-invalid={unitError ? true : undefined}
                className={`${input} aria-invalid:border-destructive`}
              >
                <option value="">
                  {units === null
                    ? "Loading units…"
                    : choices.length
                      ? "Choose a unit"
                      : "No unit yet: add one below"}
                </option>
                {choices.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.detail ? `${u.name} (${u.detail})` : u.name}
                  </option>
                ))}
                <option value="__add__">{addUnitChoice.label}</option>
              </select>
            </Field>
            {addingUnit && (
              <AddInline
                choice={addUnitChoice}
                onCancel={() => setAddingUnit(false)}
                onAdded={(id) => {
                  setAddingUnit(false);
                  setUnitError("");
                  void listActiveUnits()
                    .then(setUnits)
                    .catch(() => setUnits([]));
                  setV((c) => ({ ...c, unitId: id }));
                }}
              />
            )}
            {currentUnit && (
              <Field label={`Last day at ${currentUnit.unitName} (optional)`} error={endError}>
                <DateField
                  label={`Last day at ${currentUnit.unitName}`}
                  testId="move-ends"
                  value={v.endsOn}
                  min={currentUnit.effectiveFrom}
                  invalid={!!endError}
                  clearable
                  onChange={(d) => {
                    // The next posting starts the day after, unless the Admin
                    // has chosen its start themselves.
                    setV({
                      ...v,
                      endsOn: d,
                      effectiveFrom: !startChosen && isIsoDate(d) ? nextDay(d) : v.effectiveFrom,
                    });
                    setEndError("");
                    setDateError("");
                  }}
                />
                <span className="mt-1 block text-caption text-muted-foreground">
                  Empty, it ends the day before the new posting starts.
                </span>
              </Field>
            )}
            <Field
              label={currentUnit ? "Starts at the new unit on" : "Effective from"}
              error={dateError}
              required
            >
              <DateField
                label={currentUnit ? "Starts at the new unit on" : "Effective from"}
                required
                testId="move-from"
                value={v.effectiveFrom}
                invalid={!!dateError}
                onChange={(d) => {
                  setV({ ...v, effectiveFrom: d });
                  setStartChosen(true);
                  setDateError("");
                }}
              />
            </Field>
            {chosen?.calendar && isIsoDate(v.effectiveFrom) && (
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
            <Field label="Deployment order reference" required error={refError}>
              <input
                required
                data-testid="move-order-ref"
                value={v.orderRef}
                maxLength={LIMITS.orderRef}
                aria-invalid={refError ? true : undefined}
                onChange={(e) => {
                  setV({ ...v, orderRef: e.target.value });
                  setRefError("");
                }}
                className={`${input} font-mono aria-invalid:border-destructive`}
              />
            </Field>
            <fieldset className="min-w-0 text-sm">
              <legend className={eyebrow}>Expected duration</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <select
                  aria-label="Expected duration, years"
                  value={v.durationYears}
                  onChange={(e) => setV({ ...v, durationYears: e.target.value })}
                  className={input}
                >
                  <option value="">Years</option>
                  {range(0, 10).map((y) => (
                    <option key={y} value={String(y)}>
                      {y === 1 ? "1 year" : `${y} years`}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Expected duration, months"
                  value={v.durationMonths}
                  onChange={(e) => setV({ ...v, durationMonths: e.target.value })}
                  className={input}
                >
                  <option value="">Months</option>
                  {range(0, 11).map((m) => (
                    <option key={m} value={String(m)}>
                      {m === 1 ? "1 month" : `${m} months`}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
            <Field label="Reason for deploying">
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
              disabled={busy}
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

/**
 * Takes back the latest posting, added by mistake (D105). Never silent: a
 * reason is required and kept, with who and when, and the card says which
 * posting carries on. Only the latest, so history never has a hole in it.
 */
export function RemovePostingDialog({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: Changed;
}) {
  const latest = [...(card.deployments ?? [])].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  )[0];
  const earlier = (card.deployments ?? []).find(
    (d) => latest && d.id !== latest.id && d.effectiveTo === latest.effectiveFrom,
  );
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!latest) return null;

  async function remove() {
    setError("");
    if (reason.trim().length < 3) {
      setError("Say why it is being removed. The reason is kept with the record.");
      return;
    }
    setBusy(true);
    try {
      await withdrawPosting(latest.id, reason.trim());
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err, "The posting couldn't be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="remove-posting"
        onClick={() => {
          setReason("");
          setError("");
          setOpen(true);
        }}
        className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-destructive hover:underline"
      >
        Remove posting
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the posting to {latest.unitName}?</DialogTitle>
            <DialogDescription data-testid="remove-posting-what-happens">
              {`From ${formatDate(latest.effectiveFrom)}${
                latest.effectiveTo ? ` to ${formatDate(lastDayOf(latest.effectiveTo))}` : ""
              }, order ${latest.deploymentOrderRef}. `}
              {earlier
                ? `${earlier.unitName} carries on as though this move had not been made.`
                : "They will have no posting from that date."}{" "}
              The posting is kept, with your name and the reason, for anyone who asks later.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            <span className={eyebrow}>Why is it being removed?</span>
            <input
              data-testid="remove-posting-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Added to the wrong unit"
              className={`mt-1 ${input}`}
            />
          </label>
          {error && (
            <p role="alert" data-testid="remove-posting-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              data-testid="remove-posting-confirm"
              className="h-11 rounded-md bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-45"
            >
              {busy ? "Removing…" : "Remove the posting"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="h-11 rounded-md border border-border px-4 text-sm"
            >
              Keep it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The last day of a posting whose end is held exclusive. */
function lastDayOf(effectiveTo: string) {
  const [y, m, d] = effectiveTo.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

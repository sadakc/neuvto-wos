/**
 * D107: the company decides which fields are required and which the person
 * may change on their own card. The answers live in the database
 * (employee_field_settings) and are enforced there; this is the screen's half:
 * why an answer is fixed, in words, and which fields a card's editor offers.
 */

import type { EmployeeCard } from "./contracts";

/** Why an answer cannot be changed. The database names one of these. */
export type FieldLock =
  | "derived"
  | "company"
  | "always"
  | "record"
  | "numbers"
  | "apart"
  | "invite"
  | "some"
  | "together";

export const LOCK_REASON: Record<FieldLock, string> = {
  derived: "Worked out by Neuvto, never typed.",
  company: "Set by the company, not the person.",
  always: "Every record has one.",
  record: "A whole record, not one box. The onboarding checklist asks for it.",
  numbers: "Set by the Statutory, Payroll and Employee Admin roles.",
  apart: "Kept apart from the person's own card. Only the Statutory role writes it.",
  invite: "Set when the person is invited.",
  some: "Not everybody has one.",
  together: "Changed with Nominee name and relation: a nomination is saved as a whole.",
};

export interface FieldSetting {
  key: string;
  label: string;
  required: boolean;
  requiredLock: FieldLock | null;
  employeeCanUpdate: boolean;
  updateLock: FieldLock | null;
  /** The company has its own answer for this field. */
  customised: boolean;
  /** The person looking may change it: their company's Super Admin. */
  canChange: boolean;
}

/** One row of employee_field_settings(), as the screen holds it. */
export function fieldSettingFromRow(r: {
  field_key: string;
  label: string;
  required: boolean;
  required_lock: string | null;
  employee_can_update: boolean;
  update_lock: string | null;
  customised: boolean;
  can_change: boolean;
}): FieldSetting {
  return {
    key: r.field_key,
    label: r.label,
    required: r.required,
    requiredLock: (r.required_lock as FieldLock | null) ?? null,
    employeeCanUpdate: r.employee_can_update,
    updateLock: (r.update_lock as FieldLock | null) ?? null,
    customised: r.customised,
    canChange: r.can_change,
  };
}

/** May this card's viewer write this field: the Employee Admin any, the person their own. */
export function canWrite(card: EmployeeCard, key: string): boolean {
  return card.capabilities.canEdit || (card.capabilities.ownFields ?? []).includes(key);
}

/** May they write any of these: whether a panel offers its Edit. */
export function writesAny(card: EmployeeCard, ...keys: string[]): boolean {
  return keys.some((k) => canWrite(card, k));
}

/** Whether the company requires this field. */
export function isRequired(card: EmployeeCard, key: string): boolean {
  return (card.capabilities.requiredFields ?? []).includes(key);
}

/** The relation a family row is, as the field the company sets for it. */
export function relationField(relation: string): string {
  switch (relation) {
    case "father":
    case "mother":
    case "husband":
    case "wife":
      return relation;
    case "son":
      return "sons";
    case "daughter":
      return "daughters";
    default:
      return "otherRelatives";
  }
}

/** The family fields, for "may they change any relative". */
export const FAMILY_FIELDS = [
  "father",
  "mother",
  "husband",
  "wife",
  "sons",
  "daughters",
  "otherRelatives",
] as const;

type Spec = { key: string; kind?: string; required?: boolean };

/** The company's Required, on a form's fields. */
export function withRequired<T extends Spec>(card: EmployeeCard, fields: T[]): T[] {
  return fields.map((f) => (isRequired(card, f.key) ? { ...f, required: true } : f));
}

/**
 * The fields of a form this card's viewer may write, with the company's
 * Required on them. A worked-out field stays while anything beside it is
 * theirs; a form with nothing of theirs is empty.
 */
export function fieldsFor<T extends Spec>(card: EmployeeCard, fields: T[]): T[] {
  const mine = fields.filter((f) => f.kind === "derived" || canWrite(card, f.key));
  return mine.some((f) => f.kind !== "derived") ? withRequired(card, mine) : [];
}

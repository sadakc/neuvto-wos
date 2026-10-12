/**
 * Employee handlers.
 *
 * Thin wrappers over the database functions, which are the service. Nothing
 * here decides who may see what: `employee_card()` leaves out what the caller
 * may not see, so the JSON that arrives is already the right shape.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError } from "@/platform/errors";
import {
  employeeErrorMessage,
  type ChangeRequest,
  type ChangeRequestStatus,
  type RestrictedRead,
  type RevealField,
  type Revealed,
  type DirectoryRow,
  type EmployeeCard,
  type EmployeeStatus,
  type OrgChartNode,
} from "./contracts";

function toEmployeeError(message: string): AppError {
  const code = message.replace(/^ERROR:\s*/i, "").trim() || message;
  const kind = code.includes("NOT_FOUND")
    ? "NOT_FOUND"
    : code.includes("MODULE_NOT_ENABLED")
      ? "MODULE_NOT_ENABLED"
      : code.includes("FORBIDDEN")
        ? "FORBIDDEN"
        : "VALIDATION_FAILED";
  const status = kind === "NOT_FOUND" ? 404 : kind === "FORBIDDEN" ? 403 : 400;
  return new AppError(kind, employeeErrorMessage(code), status, {
    code,
  });
}

/** One person's card, shaped by who is asking. No id means your own. */
export async function getEmployeeCard(employeeId?: string): Promise<EmployeeCard> {
  const { data, error } = await supabase.rpc(
    "employee_card",
    employeeId ? { _employee_id: employeeId } : {},
  );
  if (error) throw toEmployeeError(error.message);
  return data as unknown as EmployeeCard;
}

/** Everybody in the company, with what everybody may see. Searched server side. */
export async function getDirectory(query?: string): Promise<DirectoryRow[]> {
  const { data, error } = await supabase.rpc("employee_directory", {
    _q: query?.trim() || undefined,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    workEmail: r.work_email,
    mobile: r.mobile,
    designation: r.designation,
    department: r.department,
    reportsTo: r.reports_to,
    deployedUnit: r.deployed_unit,
    dateOfJoining: r.date_of_joining,
    status: r.status as EmployeeStatus,
    isActive: r.is_active,
    hasSignedIn: r.has_signed_in,
    adminRole: r.admin_role,
  }));
}

/** Who reports to whom, for active people who have signed in. */
export async function getOrgChart(): Promise<OrgChartNode[]> {
  const { data, error } = await supabase.rpc("employee_org_chart");
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    managerProfileId: r.manager_profile_id,
    fullName: r.full_name,
    designation: r.designation,
    directReports: r.direct_reports,
  }));
}

// ═══════════════════════════════════════════════════════════ restricted (E6, D80)

type Values = Record<string, string | number | null>;

/** Statutory numbers and verification. Present keys are set (null clears); absent keys are left. */
export async function setStatutory(employeeId: string, values: Values): Promise<void> {
  const { error } = await supabase.rpc("employee_set_statutory", {
    _employee_id: employeeId,
    _values: values,
  });
  if (error) throw toEmployeeError(error.message);
}

export async function setBank(employeeId: string, values: Values): Promise<void> {
  const { error } = await supabase.rpc("employee_set_bank", {
    _employee_id: employeeId,
    _values: values,
  });
  if (error) throw toEmployeeError(error.message);
}

export async function setRestricted(employeeId: string, values: Values): Promise<void> {
  const { error } = await supabase.rpc("employee_set_restricted", {
    _employee_id: employeeId,
    _values: values,
  });
  if (error) throw toEmployeeError(error.message);
}

/**
 * The full values, once. The database logs the look before it answers.
 *
 * The result is returned to the caller and kept NOWHERE here: no cache, no
 * module state, no log line. The component that asked holds it in its own
 * state and drops it (D80).
 */
export async function revealRestricted(
  employeeId: string,
  fields: RevealField[],
  reason: string,
): Promise<Revealed> {
  const { data, error } = await supabase.rpc("employee_reveal_restricted", {
    _employee_id: employeeId,
    _fields: fields,
    _reason: reason,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? {}) as Revealed;
}

/** Who has looked at this person's restricted data, newest first. */
export async function getRestrictedReads(employeeId: string): Promise<RestrictedRead[]> {
  const { data, error } = await supabase.rpc("employee_restricted_reads", {
    _employee_id: employeeId,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({
    readAt: r.read_at,
    readerName: r.reader_name,
    fields: r.fields,
    reason: r.reason,
  }));
}

// ═══════════════════════════════════════════════════════════ writing the record (E7)

/** The record's own fields. Present keys are set (null clears); absent keys are left. */
export async function updateEmployee(employeeId: string, values: Values): Promise<void> {
  const { error } = await supabase.rpc("employee_update", {
    _employee_id: employeeId,
    _values: values,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface AddressInput {
  addressType: string;
  effectiveFrom: string;
  line: string;
  city: string;
  district?: string;
  state: string;
  pincode: string;
  nearestPoliceStation?: string;
  alsoPermanent?: boolean;
}

/** Adds an address and closes the open one of that type the day before. */
export async function addAddress(employeeId: string, input: AddressInput): Promise<void> {
  const { error } = await supabase.rpc("employee_add_address", {
    _employee_id: employeeId,
    _values: input as unknown as Values,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface MoveInput {
  unitId: string;
  effectiveFrom: string;
  orderRef: string;
  expectedDuration?: string;
  reason?: string;
}

/** Closes the current posting the day before and opens the new one. */
export async function moveUnit(employeeId: string, input: MoveInput): Promise<void> {
  const { error } = await supabase.rpc("employee_move_unit", {
    _employee_id: employeeId,
    _values: input as unknown as Values,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface FamilyRowInput {
  id?: string;
  relation: string;
  name: string;
  dateOfBirth?: string | null;
  isDependent: boolean;
}

/** The whole family list, as the screen holds it. */
export async function saveFamily(employeeId: string, rows: FamilyRowInput[]): Promise<void> {
  const { error } = await supabase.rpc("employee_save_family", {
    _employee_id: employeeId,
    _rows: rows as unknown as Values,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface PreviousOrgInput {
  id?: string;
  organisationName: string;
  designation?: string | null;
  fromDate: string;
  toDate: string;
  reasonForLeaving?: string | null;
}

export async function savePreviousOrgs(
  employeeId: string,
  rows: PreviousOrgInput[],
): Promise<void> {
  const { error } = await supabase.rpc("employee_save_previous_orgs", {
    _employee_id: employeeId,
    _rows: rows as unknown as Values,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface NominationInput {
  scheme: string;
  effectiveFrom: string;
  nominees: { name: string; relation: string; dateOfBirth?: string | null; sharePercent: number }[];
}

/** A new nomination that supersedes the scheme's open one, which is kept. */
export async function saveNomination(employeeId: string, input: NominationInput): Promise<void> {
  const { error } = await supabase.rpc("employee_save_nomination", {
    _employee_id: employeeId,
    _values: input as unknown as Values,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface Option {
  id: string;
  name: string;
  detail?: string | null;
}

/** Active designations, for the select. Managed lists are readable by everybody in the company. */
export async function listDesignations(): Promise<Option[]> {
  const { data, error } = await supabase
    .from("designations")
    .select("id, name, grade")
    .eq("status", "active")
    .order("name");
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((d) => ({ id: d.id, name: d.name, detail: d.grade }));
}

/** Active deployment units. The only source of a unit: there is no text path (criterion 4). */
export async function listActiveUnits(): Promise<Option[]> {
  const { data, error } = await supabase
    .from("deployment_units")
    .select("id, name, unit_type, client_name")
    .eq("status", "active")
    .order("name");
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((u) => ({ id: u.id, name: u.name, detail: u.client_name }));
}

// ═══════════════════════════════════════════════════════════ change requests (E7)

/** Ask an Admin to correct your own record. Nothing changes until they do. */
export async function requestChange(
  employeeId: string,
  section: string,
  details: string,
): Promise<void> {
  const { error } = await supabase.rpc("employee_request_change", {
    _employee_id: employeeId,
    _section: section,
    _details: details,
  });
  if (error) throw toEmployeeError(error.message);
}

/** An Admin gets the company's; anybody else gets their own. `null` for every status. */
export async function listChangeRequests(
  status: ChangeRequestStatus | null,
): Promise<ChangeRequest[]> {
  const { data, error } = await supabase.rpc("employee_change_requests", {
    _status: status ?? undefined,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    section: r.section,
    details: r.details,
    status: r.status as ChangeRequestStatus,
    resolutionNote: r.resolution_note,
    resolvedByName: r.resolved_by_name,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

export async function resolveChange(
  requestId: string,
  outcome: "done" | "declined",
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("employee_resolve_change", {
    _request_id: requestId,
    _outcome: outcome,
    _note: note?.trim() || undefined,
  });
  if (error) throw toEmployeeError(error.message);
}

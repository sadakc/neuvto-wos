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
  type AdminOverview,
  type DeactivationPreview,
  type DeactivationResult,
  type Stage,
  type ChangeRequest,
  type ChangeRequestStatus,
  type RestrictedRead,
  type RevealField,
  type Revealed,
  type DirectoryRow,
  type EmployeeCard,
  type EmployeeStatus,
  type OrgChartNode,
  type DocumentType,
  type DocumentView,
  type EmployeeDocument,
  type CardView,
  type OnboardingSettings,
  type ThisYear,
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
    stage: r.stage as Stage,
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
 * The full values, once. The database logs the look before it answers. No
 * reason is asked for since D85; one is sent only if a caller has it.
 *
 * The result is returned to the caller and kept NOWHERE here: no cache, no
 * module state, no log line. The component that asked holds it in its own
 * state and drops it (D80).
 */
export async function revealRestricted(
  employeeId: string,
  fields: RevealField[],
  reason?: string,
): Promise<Revealed> {
  const { data, error } = await supabase.rpc("employee_reveal_restricted", {
    _employee_id: employeeId,
    _fields: fields,
    ...(reason ? { _reason: reason } : {}),
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

/**
 * Adds an address and closes the open one of that type the day before.
 * Returns the id of each row it added, by type ("also the permanent address"
 * adds two), so a proof can be attached to the one it was given for (D98).
 */
export async function addAddress(
  employeeId: string,
  input: AddressInput,
): Promise<{ id: string; addressType: string }[]> {
  const { data, error } = await supabase.rpc("employee_add_address", {
    _employee_id: employeeId,
    _values: input as unknown as Values,
  });
  if (error) throw toEmployeeError(error.message);
  return ((data as { added?: { id: string; addressType: string }[] } | null)?.added ?? []).map(
    (a) => ({ id: a.id, addressType: a.addressType }),
  );
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

// ═══════════════════════════════════════════════════════════ adding and letting go (E8)

export interface DraftInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  joinedDate?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
}

/** Starts a record before anybody is invited. Needs only a name. */
export async function createDraft(values: DraftInput): Promise<string> {
  const { data, error } = await supabase.rpc("employee_create_draft", {
    _values: values as Values,
  });
  if (error) throw toEmployeeError(error.message);
  return data as string;
}

export async function updateDraft(employeeId: string, values: DraftInput): Promise<void> {
  const { error } = await supabase.rpc("employee_update_draft", {
    _employee_id: employeeId,
    _values: values as Values,
  });
  if (error) throw toEmployeeError(error.message);
}

/** Invites a draft. An incomplete record can be invited; its gaps stay on the list. */
export async function sendInvite(employeeId: string): Promise<void> {
  const { error } = await supabase.rpc("employee_send_invite", { _employee_id: employeeId });
  if (error) throw toEmployeeError(error.message);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc("employee_admin_overview");
  if (error) throw toEmployeeError(error.message);
  return data as unknown as AdminOverview;
}

export async function getDeactivationPreview(employeeId: string): Promise<DeactivationPreview> {
  const { data, error } = await supabase.rpc("employee_deactivation_preview", {
    _employee_id: employeeId,
  });
  if (error) throw toEmployeeError(error.message);
  return data as unknown as DeactivationPreview;
}

export async function deactivateEmployee(
  employeeId: string,
  successorProfileId: string,
  lastWorkingDay: string,
  reason: string,
): Promise<DeactivationResult> {
  const { data, error } = await supabase.rpc("employee_deactivate", {
    _employee_id: employeeId,
    _successor_id: successorProfileId,
    _last_working_day: lastWorkingDay,
    _reason: reason,
  });
  if (error) throw toEmployeeError(error.message);
  return data as unknown as DeactivationResult;
}

// ═══════════════════════════════════════════════════════════ the master template (D86)

/** One thing the database found, where it found it. */
export interface ImportProblem {
  tab: "people" | "family" | "nominees" | "previous";
  /** 1-based, among the tab's non-blank rows as sent. */
  row: number;
  employeeCode?: string | null;
  column?: string | null;
  section?: string;
  code: string;
}

export interface ImportResult {
  people: number;
  ready: number;
  created: number;
  skipped: number;
  problems: ImportProblem[];
}

/**
 * The whole workbook, through the card's own writers. `commit` false is the
 * dry run and keeps nothing. With `onlyClean`, the clean people are kept and
 * the rest skipped; without it, any problem keeps nothing.
 */
export async function importMaster(
  workbook: Record<string, Record<string, string>[]>,
  commit: boolean,
  onlyClean: boolean,
): Promise<ImportResult> {
  const { data, error } = await supabase.rpc("employee_import_master", {
    _workbook: workbook,
    _commit: commit,
    _only_clean: onlyClean,
  });
  if (error) {
    if (error.message.includes("UNKNOWN_COLUMN")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "The file has a column this template doesn't. Download the template again.",
        400,
      );
    }
    if (error.message.includes("ROWS_NEED_ATTENTION")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Something changed since the check. Choose the file again.",
        409,
      );
    }
    throw toEmployeeError(error.message);
  }
  return data as unknown as ImportResult;
}

// ═══════════════════════════════════════════════════════════ configuration (E9)

export interface UnitRow {
  id: string;
  name: string;
  unitType: string;
  clientName: string | null;
  location: string | null;
  state: string | null;
  attendanceCaptureMode: string | null;
  requiresPoliceVerification: boolean;
  isBillable: boolean;
  status: "active" | "retired";
  postedNow: number;
  postingsEver: number;
}

export async function listUnits(): Promise<UnitRow[]> {
  const { data, error } = await supabase.rpc("employee_units");
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    unitType: u.unit_type,
    clientName: u.client_name,
    location: u.location,
    state: u.state,
    attendanceCaptureMode: u.attendance_capture_mode,
    requiresPoliceVerification: u.requires_police_verification,
    isBillable: u.is_billable,
    status: u.status as UnitRow["status"],
    postedNow: u.posted_now,
    postingsEver: u.postings_ever,
  }));
}

export async function saveUnit(unitId: string | null, values: Values): Promise<string> {
  const { data, error } = await supabase.rpc("employee_save_unit", {
    // null adds a unit; the generated type cannot say a uuid argument may be null.
    _unit_id: unitId as string,
    _values: values,
  });
  if (error) throw toEmployeeError(error.message);
  return data as string;
}

export async function setUnitStatus(unitId: string, status: "active" | "retired"): Promise<void> {
  const { error } = await supabase.rpc("employee_set_unit_status", {
    _unit_id: unitId,
    _status: status,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface DesignationRow {
  id: string;
  name: string;
  grade: string | null;
  status: "active" | "retired";
}

/** Every designation, retired ones too, for the Admin who may bring one back. */
export async function listAllDesignations(): Promise<DesignationRow[]> {
  const { data, error } = await supabase
    .from("designations")
    .select("id, name, grade, status")
    .order("name");
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((d) => ({ ...d, status: d.status as DesignationRow["status"] }));
}

export async function saveDesignation(
  designationId: string | null,
  values: Values,
): Promise<string> {
  const { data, error } = await supabase.rpc("employee_save_designation", {
    _designation_id: designationId as string,
    _values: values,
  });
  if (error) throw toEmployeeError(error.message);
  return data as string;
}

export async function setDesignationStatus(
  designationId: string,
  status: "active" | "retired",
): Promise<void> {
  const { error } = await supabase.rpc("employee_set_designation_status", {
    _designation_id: designationId,
    _status: status,
  });
  if (error) throw toEmployeeError(error.message);
}

export interface OnboardingItem {
  key: string;
  label: string;
  dueWithinDays: number;
  mandatory: boolean;
  customised: boolean;
}

export async function listOnboardingItems(): Promise<OnboardingItem[]> {
  const { data, error } = await supabase.rpc("employee_onboarding_items");
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((i) => ({
    key: i.item_key,
    label: i.label,
    dueWithinDays: i.due_within_days,
    mandatory: i.mandatory,
    customised: i.customised,
  }));
}

export async function saveOnboardingItem(
  key: string,
  dueWithinDays: number,
  mandatory: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("employee_save_onboarding_item", {
    _item_key: key,
    _due_within_days: dueWithinDays,
    _mandatory: mandatory,
  });
  if (error) throw toEmployeeError(error.message);
}

// ═══════════════════════════════════════════════ documents (D95)

const DOCUMENT_BUCKET = "employee-documents";
const DOCUMENT_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export async function listDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase.rpc("employee_documents_list", {
    _employee_id: employeeId,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    docType: r.doc_type as DocumentType,
    title: r.title,
    fileName: r.file_name,
    sizeBytes: r.size_bytes,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
    expiresOn: r.expires_on,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by,
    status: r.status as EmployeeDocument["status"],
  }));
}

/**
 * Puts a file into the record's own folder and returns its path. Storage
 * refuses any other folder, and the database refuses a path outside the record.
 */
async function uploadToRecord(employeeId: string, file: File): Promise<string> {
  if (!DOCUMENT_MIME.includes(file.type) || file.size > DOCUMENT_MAX_BYTES) {
    throw new AppError("VALIDATION_FAILED", employeeErrorMessage("INVALID_DOCUMENT"), 400);
  }
  const { data: org, error: orgErr } = await supabase.rpc("current_org_id");
  if (orgErr || !org) throw new AppError("UNAUTHENTICATED", "Please sign in again.", 401);
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
  const path = `${org}/${employeeId}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new AppError("INTERNAL_ERROR", "The file didn't upload. Try again.", 500);
  return path;
}

/** Uploads a file into the record's own folder, then files it. */
export async function uploadDocument(input: {
  employeeId: string;
  docType: DocumentType;
  title: string;
  expiresOn: string | null;
  file: File;
}): Promise<string> {
  const path = await uploadToRecord(input.employeeId, input.file);
  const { data, error } = await supabase.rpc("employee_document_add", {
    _employee_id: input.employeeId,
    _doc_type: input.docType,
    _title: input.title,
    _file_path: path,
    _file_name: input.file.name,
    _mime_type: input.file.type,
    _size_bytes: input.file.size,
    _expires_on: input.expiresOn ?? undefined,
  });
  if (error) throw toEmployeeError(error.message);
  return data as string;
}

export async function verifyDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc("employee_document_verify", { _document_id: documentId });
  if (error) throw toEmployeeError(error.message);
}

export async function removeDocument(documentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("employee_document_remove", {
    _document_id: documentId,
    _reason: reason,
  });
  if (error) throw toEmployeeError(error.message);
}

/**
 * Logs the opening first, then asks storage for a five-minute link: storage
 * signs only against a logged view (D95), so there is no unlogged way in.
 */
export async function openDocument(documentId: string): Promise<string> {
  const { data: path, error } = await supabase.rpc("employee_document_open", {
    _document_id: documentId,
  });
  if (error) throw toEmployeeError(error.message);
  const { data, error: signErr } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(path as string, 300);
  if (signErr || !data) throw new AppError("FORBIDDEN", "That document can't be opened.", 403);
  return data.signedUrl;
}

export async function listDocumentViews(employeeId: string): Promise<DocumentView[]> {
  const { data, error } = await supabase.rpc("employee_document_views_list", {
    _employee_id: employeeId,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({
    documentId: r.document_id,
    docType: r.doc_type as DocumentType,
    title: r.title,
    viewerName: r.viewer_name,
    viewedAt: r.viewed_at,
  }));
}

// ═══════════════════════════════════════════════ the rest of the card (D97–D100)

/** D98: uploads a proof and files it against one address row, replacing any before it. */
export async function attachAddressProof(input: {
  employeeId: string;
  addressId: string;
  file: File;
}): Promise<string> {
  const path = await uploadToRecord(input.employeeId, input.file);
  const { data, error } = await supabase.rpc("employee_address_attach_proof", {
    _address_id: input.addressId,
    _file_path: path,
    _file_name: input.file.name,
    _mime_type: input.file.type,
    _size_bytes: input.file.size,
  });
  if (error) throw toEmployeeError(error.message);
  return data as string;
}

/** D97: leave left and what the person is waiting on, this year. */
export async function getThisYear(employeeId: string): Promise<ThisYear> {
  const { data, error } = await supabase.rpc("employee_this_year", { _employee_id: employeeId });
  if (error) throw toEmployeeError(error.message);
  const raw = data as unknown as ThisYear;
  return {
    leaveYear: raw.leaveYear ?? null,
    leave: raw.leave
      ? raw.leave.map((l) => ({
          ...l,
          entitled: Number(l.entitled),
          used: Number(l.used),
          pending: Number(l.pending),
          available: Number(l.available),
        }))
      : null,
    openRequests: (raw.openRequests ?? []).map((r) => ({ label: r.label, count: Number(r.count) })),
    openCorrections: Number(raw.openCorrections ?? 0),
  };
}

/** D100: who has looked at this record, newest first. */
export async function listCardViews(employeeId: string): Promise<CardView[]> {
  const { data, error } = await supabase.rpc("employee_card_views_list", {
    _employee_id: employeeId,
  });
  if (error) throw toEmployeeError(error.message);
  return (data ?? []).map((r) => ({ viewerName: r.viewer_name, viewedAt: r.viewed_at }));
}

/** D99: the company's onboarding reminder settings, and the last of each sent. */
export async function getOnboardingSettings(): Promise<OnboardingSettings> {
  const { data, error } = await supabase.rpc("employee_onboarding_settings");
  if (error) throw toEmployeeError(error.message);
  return data as unknown as OnboardingSettings;
}

export async function saveOnboardingSettings(
  remindEveryDays: number,
  escalateAfterDays: number,
): Promise<void> {
  const { error } = await supabase.rpc("employee_save_onboarding_settings", {
    _remind_every_days: remindEveryDays,
    _escalate_after_days: escalateAfterDays,
  });
  if (error) throw toEmployeeError(error.message);
}

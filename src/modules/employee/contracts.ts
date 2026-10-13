/**
 * Employee Master — the shapes the database hands back.
 *
 * Almost every block on the card is OPTIONAL, and that is the design rather
 * than sloppiness: `employee_card()` leaves out whatever the caller's
 * relationship to the person does not allow (NEUVTO_EMPLOYEE_MASTER §5). A
 * missing key means "not yours to see", never "empty". The screen therefore
 * decides what to render from what arrived, and has no role logic of its own
 * to drift from the database's.
 */

import { RULE_MESSAGES } from "./fieldRules";

/** `removed`: the person's account was deleted; the record is history. */
export type Stage = "draft" | "invited" | "active" | "deactivated" | "removed";

export const STAGE_LABEL: Record<Stage, string> = {
  draft: "Draft",
  invited: "Invited",
  active: "Active",
  deactivated: "Deactivated",
  removed: "Removed",
};

export type Relationship = "colleague" | "self" | "admin" | "payroll" | "statutory" | "approver";

export const EMPLOYEE_STATUSES = ["working", "probation", "notice", "suspended", "left"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  working: "Working",
  probation: "On probation",
  notice: "Serving notice",
  suspended: "Suspended",
  left: "Left",
};

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full time",
  contract: "Contract",
  apprentice: "Apprentice",
  part_time: "Part time",
  intern: "Intern",
  consultant: "Consultant",
};

export const UNIT_TYPE_LABEL: Record<string, string> = {
  own_establishment: "Own establishment",
  client_site: "Client site",
};

export interface Address {
  id: string;
  addressType: string;
  line: string;
  city: string;
  district: string | null;
  state: string;
  pincode: string;
  nearestPoliceStation: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  recordedBy: string | null;
  recordedAt: string;
  /**
   * D98: the proof on file for this address. The key is present only for the
   * person and the Employee Admin, the two who may open it; null means none.
   */
  proof?: AddressProof | null;
}

export interface AddressProof {
  documentId: string;
  fileName: string;
  uploadedAt: string;
  verified: boolean;
}

export interface Deployment {
  id: string;
  unitId: string;
  unitName: string;
  unitType: string;
  unitRetired: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  deploymentOrderRef: string;
  expectedDuration: string | null;
  reason: string | null;
  movedBy: string | null;
}

export interface FamilyMember {
  id: string;
  relation: string;
  name: string;
  dateOfBirth: string | null;
  isDependent: boolean;
}

export interface Nominee {
  id: string;
  name: string;
  relation: string;
  dateOfBirth: string | null;
  sharePercent: number;
}

export interface Nomination {
  id: string;
  scheme: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  nominees: Nominee[];
}

export interface PreviousOrganisation {
  id: string;
  organisationName: string;
  designation: string | null;
  fromDate: string;
  toDate: string;
  reasonForLeaving: string | null;
}

export interface EmployeeCard {
  // ── everybody in the organisation
  id: string;
  employeeCode: string | null;
  fullName: string | null;
  workEmail: string | null;
  mobile: string | null;
  alternateMobile: string | null;
  status: EmployeeStatus;
  isActive: boolean;
  hasSignedIn: boolean;
  /** E8. Where the person is in joining: started by an Admin, invited, here, or gone. */
  stage?: Stage;
  dateOfJoining: string | null;
  designation: { id: string; name: string; grade: string | null } | null;
  department: { id: string; name: string } | null;
  /** `profileId` is whom "Reports to" names; `id` is their record, for the link. */
  reportsTo: { id: string | null; fullName: string | null; profileId?: string | null } | null;
  directReportCount: number;
  currentDeployment: {
    unitId: string;
    unitName: string;
    unitType: string;
    effectiveFrom: string;
  } | null;
  relationship: Relationship[];

  // ── the work record: self, admin, payroll, statutory, approver
  totalExperienceMonths?: number;
  /** D104: typed by an Admin as years and months; when set, it stands in for the previous organisations' sum. */
  priorExperienceMonths?: number | null;
  employmentType?: string | null;
  confirmedOn?: string | null;

  // ── self and admin
  nameAsPerId?: string | null;
  sex?: string | null;
  dateOfBirth?: string | null;
  age?: number | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  nativeState?: string | null;
  bloodGroup?: string | null;
  educationQualification?: string | null;
  personalEmail?: string | null;
  reJoiningDate?: string | null;
  terminationDate?: string | null;
  terminationReason?: string | null;
  reasonForLeavingLastOrg?: string | null;
  physical?: { heightCm: number | null; chestCm: number | null; weightKg: number | null };
  previousOrganisations?: PreviousOrganisation[];

  // ── self, admin, approver
  emergencyContact?: { name: string | null; relation: string | null; phone: string | null };

  // ── self, admin, statutory
  nearestPoliceStation?: string | null;
  addresses?: Address[];

  // ── self, admin, payroll, statutory
  familyMembers?: FamilyMember[];
  nominations?: Nomination[];
  deployments?: Deployment[];
  /** D105: the posting that starts after today, if a move is dated ahead. */
  nextDeployment?: { unitName: string; effectiveFrom: string } | null;
  /** D105: postings an Admin took back, with why. The Admin's card only. */
  withdrawnPostings?: {
    unitName: string;
    effectiveFrom: string;
    reason: string;
    withdrawnBy: string | null;
    withdrawnAt: string;
  }[];

  // ── E6 (D80). Full numbers only where §5 grants them; otherwise last four.
  /** Self, Admin, Payroll, Statutory. `uan` and friends only for Payroll and Statutory. */
  statutory?: StatutoryBlock;
  /** Self, Admin, Statutory. */
  verification?: VerificationBlock;
  /** Self (last four) and Payroll. Never Admin or Statutory. */
  bank?: BankBlock;
  /** Self and Statutory: only whether anything is held. Values come by reveal. */
  restricted?: { recorded: boolean };

  /** D102: the calendar and shift they work to today. Everybody in the company. */
  workPattern?: WorkPattern;

  capabilities: {
    canEdit: boolean;
    canRequestChange: boolean;
    canSeeHistory: boolean;
    canRevealStatutory: boolean;
    canRevealBank?: boolean;
    canRevealRestricted?: boolean;
    canEditStatutory?: boolean;
    canEditVerification?: boolean;
    canEditBank?: boolean;
    canEditRestricted?: boolean;
    canSeeReveals?: boolean;
    /** D100: who has looked at this record. The person and a Super Admin. */
    canSeeViews?: boolean;
    /** D97: the year so far. The person, the Employee Admin and their manager. */
    canSeeThisYear?: boolean;
    /** D102: give the person their own shift, or return them to their unit's. */
    canSetShift?: boolean;
    canSendInvite?: boolean;
    canDeactivate?: boolean;
    canEditDraft?: boolean;
    /**
     * D107: the fields the company requires, and those the person may change
     * on their own card, each by field and by the keys a save takes. The
     * second is empty for everybody but the person.
     */
    requiredFields?: string[];
    ownFields?: string[];
  };
}

export interface StatutoryBlock {
  recorded: boolean;
  identityDocumentType: string | null;
  aadhaarLast4: string | null;
  panLast4: string | null;
  /** D105: a driving licence number, encrypted like PAN. */
  licenceLast4?: string | null;
  verifiedOn: string | null;
  uanLast4: string | null;
  epfLast4: string | null;
  esicLast4: string | null;
  oldUanLast4: string | null;
  oldEsicLast4: string | null;
  uan?: string | null;
  epfNumber?: string | null;
  esicNumber?: string | null;
  oldUan?: string | null;
  oldEsicNumber?: string | null;
}

export const CHECK_STATUSES = [
  "not_started",
  "pending",
  "verified",
  "failed",
  "not_applicable",
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface VerificationBlock {
  policeVerification: CheckStatus;
  policeVerifiedOn: string | null;
  previousEmployerCheck: CheckStatus;
  educationCheck: CheckStatus;
  reverificationDue: string | null;
}

export interface BankBlock {
  recorded: boolean;
  bankName: string | null;
  ifsc: string | null;
  accountLast4: string | null;
  pennyDropStatus: "not_checked" | "verified" | "failed";
  branch?: string | null;
  accountHolder?: string | null;
}

/** What a reveal may ask for (employee_reveal_restricted). */
export type RevealField =
  | "uan"
  | "epf_number"
  | "esic_number"
  | "old_uan"
  | "old_esic_number"
  | "aadhaar"
  | "pan"
  | "driving_licence"
  | "bank_account"
  | "religion"
  | "caste_category"
  | "disability";

export interface Revealed {
  uan?: string | null;
  epfNumber?: string | null;
  esicNumber?: string | null;
  oldUan?: string | null;
  oldEsicNumber?: string | null;
  aadhaar?: string | null;
  pan?: string | null;
  drivingLicence?: string | null;
  bankAccount?: string | null;
  religion?: string | null;
  casteCategory?: string | null;
  disabilityStatus?: string | null;
  disabilityPercent?: number | null;
}

export interface RestrictedRead {
  readAt: string;
  readerName: string | null;
  fields: string[];
  /** D85: the eye asks for none, so most looks have no reason. */
  reason: string | null;
}

export const RELATIONS = [
  "father",
  "mother",
  "husband",
  "wife",
  "son",
  "daughter",
  "brother",
  "sister",
  "guardian",
  "other",
] as const;
export const ADDRESS_TYPES = ["present", "permanent", "while_deployed", "emergency"] as const;
export const NOMINATION_SCHEMES = ["pf_and_gratuity", "esic", "insurance"] as const;
export const SEXES = ["male", "female", "other", "undisclosed"] as const;
export const MARITAL_STATUSES = ["single", "married", "widowed", "divorced", "separated"] as const;
/** D104: Indian first and the default, then the neighbours a workforce most often comes from. */
export const NATIONALITIES = ["Indian", "Nepali", "Bangladeshi"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const EMPLOYMENT_TYPES = [
  "full_time",
  "contract",
  "apprentice",
  "part_time",
  "intern",
  "consultant",
] as const;

export const CHANGE_SECTIONS = [
  ["contact", "Contact details"],
  ["emergency_contact", "Emergency contact"],
  ["address", "Address"],
  ["family", "Family"],
  ["nominees", "Nominees"],
  ["other", "Something else"],
] as const;

export type ChangeRequestStatus = "open" | "done" | "declined";

export interface ChangeRequest {
  id: string;
  employeeId: string;
  employeeName: string | null;
  section: string;
  details: string;
  status: ChangeRequestStatus;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export const CASTE_CATEGORIES = ["general", "obc", "sc", "st", "ews", "not_disclosed"] as const;
export const DISABILITY_STATUSES = ["none", "disabled", "not_disclosed"] as const;

export interface DirectoryRow {
  id: string;
  employeeCode: string | null;
  fullName: string | null;
  workEmail: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  reportsTo: string | null;
  deployedUnit: string | null;
  dateOfJoining: string | null;
  status: EmployeeStatus;
  isActive: boolean;
  hasSignedIn: boolean;
  /** "Super Admin", "Admin" or null. */
  adminRole: string | null;
  stage: Stage;
}

export interface OrgChartNode {
  id: string;
  profileId: string;
  managerProfileId: string | null;
  fullName: string | null;
  designation: string | null;
  directReports: number;
}

/** What a refusal from this module's functions means to the person reading it. */
export function employeeErrorMessage(code: string, detail?: string | null): string {
  if (code.includes("MODULE_NOT_ENABLED")) {
    return "Employee records aren't switched on for your company.";
  }
  // D107: the company's own rules name the field they hold.
  if (code.includes("FIELD_REQUIRED")) {
    return `${detail ?? "That field"} is required. Fill it in before saving.`;
  }
  if (code.includes("NOT_YOURS_TO_CHANGE")) {
    return `Your company doesn't let you change ${detail ? detail.toLowerCase() : "that"} yourself. Ask with Request a change.`;
  }
  if (code.includes("SUPER_ADMIN_ONLY")) {
    return "Only a Super Admin can change which fields are required or theirs to update.";
  }
  if (code.includes("FIELD_LOCKED")) {
    return `${detail ?? "That field"} is fixed. The table says why.`;
  }
  // D103: a refused value names the rule it broke, so the message can name the field.
  if (code.includes("INVALID_VALUE") && detail && RULE_MESSAGES[detail]) {
    return RULE_MESSAGES[detail];
  }
  const specific: [string, string][] = [
    ["DEPARTMENT_NOT_FOUND", "That department isn't on your company's list any more."],
    [
      "MANAGER_NOT_FOUND",
      "Nobody in Neuvto has that email yet. They must be a member to be reported to.",
    ],
  ];
  for (const [needle, message] of specific) if (code.includes(needle)) return message;
  if (code.includes("NOT_FOUND")) {
    return "There's nobody with that record in your company.";
  }
  const write: [string, string][] = [
    // D95, documents.
    ["FILE_NOT_IN_RECORD", "That file couldn't be attached. Upload it again."],
    ["FILE_NOT_UPLOADED", "The file didn't finish uploading. Try again."],
    ["FILE_ALREADY_FILED", "That file is already on the record."],
    [
      "TITLE_REQUIRED",
      "Say which one it is: the employer a relieving letter is from, or what the document is.",
    ],
    ["ALREADY_EXPIRED", "That expiry date has passed. Upload a document that's still valid."],
    ["INVALID_DOCUMENT", "Upload a PDF or a photo (PNG, JPEG or WebP) of 10 MB or less."],
    ["NOT_YOUR_OWN", "Somebody else has to verify your own documents."],
    [
      "STATUTORY_KEY_NOT_SET",
      "Statutory data can't be stored yet: this environment's encryption key isn't set. Tell Neuvto support.",
    ],
    ["INVALID_AADHAAR", "That isn't a valid Aadhaar number. Check the 12 digits."],
    ["INVALID_PAN", "A PAN is five letters, four digits and a letter, like ABCDE1234F."],
    ["INVALID_UAN", "A UAN is 12 digits."],
    ["INVALID_ESIC", "An ESIC number is 10 or 17 digits."],
    ["INVALID_EPF", "That doesn't look like an EPF member number."],
    ["INVALID_IFSC", "An IFSC is four letters, a zero, then six letters or digits."],
    ["INVALID_ACCOUNT", "An account number is 9 to 18 digits."],
    ["AADHAAR_ALREADY_RECORDED", "Somebody else in your company already has this Aadhaar number."],
    ["PAN_ALREADY_RECORDED", "Somebody else in your company already has this PAN."],
    [
      "REASON_REQUIRED",
      "Say why you need to see it. The reason is kept with the record of this look.",
    ],
    ["FORBIDDEN", "Your role can't do that. Ask somebody with the Statutory or Payroll role."],
    ["INVALID_VALUE", "One of those values isn't allowed. Check the fields and try again."],
    ["UNKNOWN_FIELD", "That field isn't recognised."],
    [
      "EFFECTIVE_DATE_CLASH",
      "That date isn't after the current row's start. History can't be rewritten; pick a later date.",
    ],
    ["ORDER_REF_REQUIRED", "A move needs a deployment order reference."],
    ["UNIT_NOT_AVAILABLE", "That unit isn't available. Choose an active unit."],
    ["ALREADY_DEPLOYED_THERE", "They're already deployed there."],
    // D105, deployments, nominations and numbers.
    [
      "STARTS_BEFORE_THE_LAST_ENDS",
      "The new posting has to start after the current one's last day.",
    ],
    ["ENDS_BEFORE_IT_BEGAN", "The current posting can't end before it began."],
    ["NOT_THE_LATEST", "Only the latest posting can be removed. Remove the ones after it first."],
    [
      "OLD_UAN_IS_CURRENT",
      "The old UAN is the same as the current one. An old UAN is a previous account.",
    ],
    [
      "OLD_ESIC_IS_CURRENT",
      "The old ESIC number is the same as the current one. An old number is a previous one.",
    ],
    ["ORDER_INCOMPLETE", "The list changed while you were ordering it. Reload and try again."],
    [
      "INVALID_LICENCE",
      "A driving licence number starts with the state's two letters, like KA01 20110012345.",
    ],
    // D102, shift and calendar.
    ["CALENDAR_NOT_AVAILABLE", "That calendar isn't available. Choose one in use."],
    ["CALENDAR_NAME_TAKEN", "There's already a calendar with that name."],
    ["CALENDAR_IN_USE", "A unit uses that calendar. Give the unit another one first."],
    [
      "COMPANY_CALENDAR_IS_SET_IN_SETTINGS",
      "The Company calendar's days off are set on Settings, under Working calendar.",
    ],
    ["SHIFT_NOT_AVAILABLE", "That shift isn't available. Choose one in use."],
    ["SHIFT_NAME_TAKEN", "There's already a shift with that name."],
    ["SHIFT_IN_USE", "That shift is a unit's default or somebody's own. Change those first."],
    ["NO_OWN_SHIFT", "They already work their unit's shift."],
    ["ALREADY_ON_THAT_SHIFT", "They already work that shift."],
    ["NOMINEE_SHARES_NOT_100", "Nominee shares must add up to exactly 100%."],
    ["NOMINEES_REQUIRED", "Add at least one nominee."],
    ["NOT_ON_PEOPLE", "Not on the People tab. Check the employee code."],
    ["TWICE_IN_FILE", "Appears twice in this file."],
    ["CODE_TAKEN", "Somebody in your company already has this employee code."],
    [
      "UNKNOWN_DESIGNATION",
      "Not a designation in Configuration. Add it there first, or fix the spelling.",
    ],
    [
      "UNKNOWN_DEPARTMENT",
      "Not a department in Settings. Add it there first, or fix the spelling.",
    ],
    [
      "UNKNOWN_UNIT",
      "Not a deployment unit in Configuration. Add it there first, or fix the spelling.",
    ],
    [
      "MANAGER_NOT_FOUND",
      "Nobody in Neuvto has that email yet. They must be a member to be reported to.",
    ],
    ["MANAGER_CANNOT_APPROVE", "That person can't approve. Make them a Manager first."],
    ["SELF_MANAGED", "Nobody reports to themselves."],
    ["REPORTING_CYCLE", "That would make a loop: that person already reports up to them."],
    ["MOBILE_TAKEN", "Somebody in your company already has that mobile number."],
    ["DESIGNATION_NAME_TAKEN", "There's already a designation with that name."],
    ["CANNOT_CHANGE_OWN_ROLES", "You can't change your own roles. Ask another Super Admin."],
    ["ROLE_NOT_YOURS_TO_GRANT", "Only a Super Admin can make somebody a Manager."],
    ["NAME_REQUIRED", "A name is required."],
    ["REQUIRED", "Required."],
    ["ALREADY_A_DRAFT", "This email already belongs to a draft."],
    ["ALREADY_A_MEMBER", "This email already belongs to a member."],
    ["INVALID_EMAIL", "Not an email address."],
    [
      "DESIGNATION_NOT_AVAILABLE",
      "That designation isn't available any more. Choose an active one.",
    ],
  ];
  for (const [needle, message] of write) if (code.includes(needle)) return message;
  if (code.includes("NOT_AUTHENTICATED")) {
    return "Your session has ended. Sign in again.";
  }
  return "That didn't load. Please try again.";
}

export interface AdminOverview {
  managers: { profileId: string; fullName: string }[];
  departments: { id: string; name: string }[];
  active: number;
  invitedNotSignedIn: number;
  drafts: number;
  deployedToClientUnits: number;
  missingStatutory: number;
  recent: {
    id: string;
    fullName: string | null;
    email: string | null;
    stage: Stage;
    createdAt: string;
    /** employee_onboarding_gaps(): what is still missing, each with when it was due. */
    gaps: { key: string; label: string; dueOn: string | null; overdue: boolean }[];
  }[];
}

export interface DeactivationPreview {
  directReports: number;
  pendingApprovals: number;
  openPosting: { unitName: string; since: string } | null;
  successors: { profileId: string; fullName: string }[];
}

export interface DeactivationResult {
  reports_moved: number;
  approvals_moved: number;
  levels_collapsed: number;
  postingClosed: { unitName: string; lastDay: string } | null;
  status: string;
  lastWorkingDay: string;
}

// ═══════════════════════════════════════════════ documents (D95)

/** The twelve documents a record holds, in the prototype's order and words. */
export const DOCUMENT_TYPES = [
  { key: "offer_letter", label: "Offer letter", category: "Onboarding" },
  { key: "appointment_letter", label: "Appointment letter", category: "Onboarding" },
  { key: "aadhaar", label: "Aadhaar card", category: "Statutory" },
  { key: "pan", label: "PAN card", category: "Statutory" },
  { key: "pf_nomination", label: "Form 2, PF nomination", category: "Statutory" },
  { key: "bank_proof", label: "Bank passbook first page or cancelled cheque", category: "Payroll" },
  { key: "education", label: "Degree or qualification certificate", category: "Education" },
  { key: "relieving_letter", label: "Relieving letter", category: "Background", named: true },
  {
    key: "police_verification",
    label: "Police verification report",
    category: "Background",
    expires: true,
  },
  { key: "passport", label: "Passport", category: "Travel", expires: true },
  { key: "insurance_nomination", label: "Medical insurance nomination", category: "Benefits" },
  { key: "other", label: "Other document", category: "Other", named: true },
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number]["key"];

export interface EmployeeDocument {
  id: string;
  docType: DocumentType;
  /** The employer of a relieving letter; what an "other" is. */
  title: string | null;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
  expiresOn: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  status: "uploaded" | "verified" | "expired";
}

export interface DocumentView {
  documentId: string;
  /** A Documents tab type, or "address_proof" for a proof on an address (D98). */
  docType: DocumentType | "address_proof";
  title: string | null;
  viewerName: string;
  viewedAt: string;
}

// ═══════════════════════════════════════════════ the rest of the card (D97–D100)

/** D97: Overview's "This year". */
export interface ThisYear {
  leaveYear: string | null;
  /** Null when the company has not switched Leave on. */
  leave:
    | {
        leaveTypeId: string;
        name: string;
        kind: "paid" | "earned";
        entitled: number;
        used: number;
        pending: number;
        available: number;
      }[]
    | null;
  openRequests: { label: string; count: number }[];
  openCorrections: number;
}

/** D100: one look at somebody's record. */
export interface CardView {
  viewerName: string;
  viewedAt: string;
}

/** D99: how often the Employee Admins are reminded, and when Super Admins are told. */
export interface OnboardingSettings {
  remindEveryDays: number;
  escalateAfterDays: number;
  lastReminder: { sentAt: string; people: number } | null;
  lastEscalation: { sentAt: string; people: number } | null;
}

// ═══════════════════════════════════════════════ shift and calendar (D102)

export interface ShiftTimes {
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export interface WorkPattern {
  calendar: { id: string; name: string; weeklyOff: number[]; isDefault: boolean };
  /** "unit": the unit names its calendar; "company": the Company calendar. */
  calendarSource: "unit" | "company";
  unitName: string | null;
  shift: (ShiftTimes & { id: string; name: string }) | null;
  /** "person": their own shift; "unit": their unit's default; null: none. */
  shiftSource: "person" | "unit" | null;
  ownShiftSince: string | null;
  /** The person, the Employee Admin and their manager only. */
  ownShifts?: {
    id: string;
    shiftName: string;
    startTime: string;
    endTime: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    reason: string | null;
    setBy: string | null;
  }[];
}

export interface CalendarRow {
  id: string;
  name: string;
  weeklyOff: number[];
  isDefault: boolean;
  status: "active" | "retired";
  units: number;
}

export interface ShiftRow extends ShiftTimes {
  id: string;
  name: string;
  status: "active" | "retired";
  units: number;
  people: number;
}

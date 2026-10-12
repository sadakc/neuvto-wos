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
  dateOfJoining: string | null;
  designation: { id: string; name: string; grade: string | null } | null;
  department: { id: string; name: string } | null;
  reportsTo: { id: string | null; fullName: string | null } | null;
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

  // ── E6 (D80). Full numbers only where §5 grants them; otherwise last four.
  /** Self, Admin, Payroll, Statutory. `uan` and friends only for Payroll and Statutory. */
  statutory?: StatutoryBlock;
  /** Self, Admin, Statutory. */
  verification?: VerificationBlock;
  /** Self (last four) and Payroll. Never Admin or Statutory. */
  bank?: BankBlock;
  /** Self and Statutory: only whether anything is held. Values come by reveal. */
  restricted?: { recorded: boolean };

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
  };
}

export interface StatutoryBlock {
  recorded: boolean;
  identityDocumentType: string | null;
  aadhaarLast4: string | null;
  panLast4: string | null;
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
  | "aadhaar"
  | "pan"
  | "bank_account"
  | "religion"
  | "caste_category"
  | "disability";

export interface Revealed {
  aadhaar?: string | null;
  pan?: string | null;
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
  reason: string;
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
export function employeeErrorMessage(code: string): string {
  if (code.includes("MODULE_NOT_ENABLED")) {
    return "Employee records aren't switched on for your company.";
  }
  if (code.includes("NOT_FOUND")) {
    return "There's nobody with that record in your company.";
  }
  const write: [string, string][] = [
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
    ["NOMINEE_SHARES_NOT_100", "Nominee shares must add up to exactly 100%."],
    ["NOMINEES_REQUIRED", "Add at least one nominee."],
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

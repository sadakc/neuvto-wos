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

  capabilities: {
    canEdit: boolean;
    canRequestChange: boolean;
    canSeeHistory: boolean;
    canRevealStatutory: boolean;
  };
}

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
  if (code.includes("NOT_AUTHENTICATED")) {
    return "Your session has ended. Sign in again.";
  }
  return "That didn't load. Please try again.";
}

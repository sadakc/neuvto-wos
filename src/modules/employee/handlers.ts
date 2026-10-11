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
      : "VALIDATION_FAILED";
  return new AppError(kind, employeeErrorMessage(code), kind === "NOT_FOUND" ? 404 : 400, {
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

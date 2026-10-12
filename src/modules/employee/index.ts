/**
 * Employee Master — the module's entire public surface.
 *
 * The record every other module reads (NEUVTO_EMPLOYEE_MASTER). E5 is the read
 * side: My Card, the Directory and the Org Chart. Who sees which part of a
 * card is decided in `employee_card()`, not here.
 */

import { lazy } from "react";
import { IdCard } from "lucide-react";
import { z } from "zod";
import type { ModuleDefinition } from "@/platform/modules";

export const employee: ModuleDefinition = {
  key: "employee",
  name: "Employee Master",
  version: "0.5.0",
  shortName: "Employees",
  section: "People",
  icon: IdCard,

  navigation: () => [
    { label: "My Card", to: "/app/employee" },
    { label: "Directory", to: "/app/employee/directory" },
    { label: "Org Chart", to: "/app/employee/org-chart" },
    {
      label: "Add Employee",
      to: "/app/employee/add",
      group: "company",
      roles: ["super_admin", "org_admin", "hr_admin"],
      description: "Start a record and invite them, complete or not",
    },
    {
      label: "Import records",
      to: "/app/employee/import",
      group: "company",
      roles: ["super_admin"],
      description: "Bring a workforce in from a spreadsheet, as drafts",
    },
    {
      label: "Configuration",
      to: "/app/employee/config",
      group: "company",
      roles: ["super_admin", "org_admin", "hr_admin"],
      description: "Units, designations, the onboarding checklist and the record's rules",
    },
    {
      label: "Change requests",
      to: "/app/employee/change-requests",
      group: "company",
      roles: ["super_admin", "org_admin", "hr_admin"],
      description: "Corrections people have asked for on their own record",
    },
  ],

  routes: [
    { path: "employee", component: lazy(() => import("./components/MyCard")) },
    { path: "employee/directory", component: lazy(() => import("./components/Directory")) },
    // Under Directory, so the tab bar keeps Directory lit while you read somebody.
    { path: "employee/directory/person", component: lazy(() => import("./components/PersonCard")) },
    { path: "employee/org-chart", component: lazy(() => import("./components/OrgChart")) },
    { path: "employee/add", component: lazy(() => import("./components/Lifecycle")) },
    { path: "employee/import", component: lazy(() => import("./components/ImportRecords")) },
    { path: "employee/config", component: lazy(() => import("./components/Configuration")) },
    {
      path: "employee/change-requests",
      component: lazy(() => import("./components/ChangeRequests")),
    },
  ],

  // Change requests go to admins directly, not through approval chains: an
  // Admin acts on them, nobody signs them off.
  approvalEntityTypes: [],
  eventKeys: ["employee.change_requested", "employee.change_resolved"],
  settingsSchema: z.object({}),

  ownedTables: [
    "employees",
    "designations",
    "deployment_units",
    "employee_addresses",
    "employee_deployments",
    "nomination_versions",
    "nominees",
    "family_members",
    "previous_organisations",
    "employee_statutory",
    "employee_bank",
    "employee_restricted",
    "restricted_reads",
    "employee_change_requests",
    "employee_onboarding_items",
  ],
};

export { getEmployeeCard, getDirectory, getOrgChart } from "./handlers";
export type { EmployeeCard, DirectoryRow, OrgChartNode } from "./contracts";

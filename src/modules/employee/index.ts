/**
 * Employee Card (named the Employee Master until D105) — the module's entire public surface.
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
  name: "Employee Card",
  version: "0.5.0",
  shortName: "Employees",
  section: "People",
  icon: IdCard,

  navigation: () => [
    { label: "My Card", to: "/app/employee" },
    // Your own reporting line. The whole company's chart, and the directory
    // of everybody, are views of the company: under Organisation, where the
    // directory is for its admins only (Sada, 14 Oct 2026).
    { label: "Org Chart", to: "/app/employee/my-org-chart" },
    {
      label: "Directory",
      to: "/app/employee/directory",
      placement: "organisation",
      moduleAdmin: true,
      description: "Everybody, with their unit and status; open a record to edit it",
    },
    { label: "Org Chart", to: "/app/employee/org-chart", placement: "organisation" },
    {
      label: "Add Employee",
      to: "/app/employee/add",
      group: "company",
      moduleAdmin: true,
      description: "Start a record and invite them, complete or not",
    },
    {
      label: "Import records",
      to: "/app/employee/import",
      group: "company",
      moduleAdmin: true,
      description: "Bring a workforce in from the master template, as drafts",
    },
    {
      label: "Configuration",
      to: "/app/employee/config",
      group: "company",
      moduleAdmin: true,
      description: "Units, designations, the onboarding checklist and the record's rules",
    },
    {
      label: "Change requests",
      to: "/app/employee/change-requests",
      group: "company",
      moduleAdmin: true,
      description: "Corrections people have asked for on their own record",
    },
  ],

  routes: [
    { path: "employee", component: lazy(() => import("./components/MyCard")) },
    { path: "employee/directory", component: lazy(() => import("./components/Directory")) },
    // Under Directory, so the tab bar keeps Directory lit while you read somebody.
    { path: "employee/directory/person", component: lazy(() => import("./components/PersonCard")) },
    { path: "employee/org-chart", component: lazy(() => import("./components/OrgChart")) },
    { path: "employee/my-org-chart", component: lazy(() => import("./components/MyOrgChart")) },
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
  eventKeys: [
    "employee.change_requested",
    "employee.change_resolved",
    "employee.changed_own_record",
  ],

  // D111. Where each of this module's notices opens from the bell.
  notificationLinks: {
    "employee.change_requested": () => "/app/employee/change-requests",
    "employee.change_resolved": () => "/app/employee",
    "employee.changed_own_record": (p) =>
      typeof p.employee_id === "string"
        ? `/app/employee/directory/person?id=${p.employee_id}`
        : "/app/employee/change-requests",
    "employee.onboarding_overdue": () => "/app/employee/add",
    "employee.onboarding_escalated": () => "/app/employee/add",
  },

  // D111. Change requests wait on the Employee Admins on Home's Approvals too.
  homeQueues: () => [
    {
      id: "change-requests",
      title: "Change requests",
      component: lazy(() => import("./components/ChangeRequestsQueue")),
    },
  ],
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

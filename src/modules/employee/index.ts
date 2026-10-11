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
  ],

  routes: [
    { path: "employee", component: lazy(() => import("./components/MyCard")) },
    { path: "employee/directory", component: lazy(() => import("./components/Directory")) },
    // Under Directory, so the tab bar keeps Directory lit while you read somebody.
    { path: "employee/directory/person", component: lazy(() => import("./components/PersonCard")) },
    { path: "employee/org-chart", component: lazy(() => import("./components/OrgChart")) },
  ],

  // Nothing to approve and nothing to announce yet; E7 adds change requests.
  approvalEntityTypes: [],
  eventKeys: [],
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
  ],
};

export { getEmployeeCard, getDirectory, getOrgChart } from "./handlers";
export type { EmployeeCard, DirectoryRow, OrgChartNode } from "./contracts";

/**
 * Payroll — the module's entire public surface.
 *
 * Nothing outside this folder imports anything deeper than this file, and only
 * `src/modules/registry.ts` imports it at all. Both rules are enforced in CI.
 *
 * One deliberate difference from Leave: the arithmetic is NOT in this folder
 * either. It lives in `src/payroll-core`, a peer package with no database, no
 * clock and no React, whose acceptance test is a real month of the spreadsheet
 * this module replaces — 44 employees, every figure, against what Excel
 * produced. This folder is the module; that package is the sum.
 */

import { lazy } from "react";
import type { ModuleDefinition } from "@/platform/modules";
import { PayrollSettings } from "./contracts";

export const payroll: ModuleDefinition = {
  key: "payroll",
  name: "Payroll",
  version: "1.0.0",

  /**
   * Two entries, and only one of them is for everybody.
   *
   * "Pay runs" used to be offered to every person in the workspace and then
   * refuse them on arrival — a link whose only function was to waste a tap. It
   * is now declared for administrators, so an employee's payroll is exactly one
   * destination: their own payslip. That is Sada's rule for the employee view,
   * expressed where the shell can read it.
   *
   * The role list is presentation. `pay_run_lines` and every payroll function
   * refuse a non-administrator themselves, because a screen that is merely not
   * linked is not a permission.
   */
  navigation: () => [
    { label: "Pay runs", to: "/app/payroll", roles: ["org_admin", "hr_admin"] },
    { label: "Payslips", to: "/app/payroll/payslips" },
  ],

  routes: [
    { path: "payroll", component: lazy(() => import("./components/PayRuns")) },
    { path: "payroll/payslips", component: lazy(() => import("./components/MyPayslip")) },
  ],

  /**
   * What an administrator configures, in the order it has to be done.
   *
   * Components first, because a salary structure is an amount against each of
   * them and the structure screen can do nothing until they exist. Structures
   * second, because a pay run computes nothing without them. Statutory details
   * last, because no figure on a payslip depends on them — they decide only
   * whether the returns and the bank file can be filed.
   *
   * Contributed rather than routed, so the platform's settings page renders all
   * three without importing anything here.
   */
  adminSections: () => [
    {
      id: "pay-schedule",
      title: "Pay schedule",
      description:
        "When salary is credited, and what a month's worth of days is. First, because it decides the date on every payslip this module will ever issue — and because an employee's first question is when, not how much.",
      component: lazy(() => import("./components/PaySchedule")),
      order: 5,
    },
    {
      id: "statutory-components",
      title: "Statutory components",
      description:
        "Provident fund, state insurance, professional tax, the labour welfare fund and statutory bonus. Each is a switch: none of them applies to every establishment, and two of them are levied by states that disagree with each other.",
      component: lazy(() => import("./components/StatutoryComponents")),
      order: 8,
    },
    {
      id: "salary-components",
      title: "Salary components",
      description:
        "The parts a salary is made of, and which of them count towards provident fund wages. Set these up before anybody's salary structure.",
      component: lazy(() => import("./components/SalaryComponents")),
      order: 10,
    },
    {
      id: "salary-structures",
      title: "Salary structures",
      description:
        "What each person is paid each month, and from when. Anybody without one cannot be paid, and is named here rather than quietly left out of the run.",
      component: lazy(() => import("./components/SalaryStructures")),
      order: 20,
    },
    {
      id: "employee-payroll-details",
      title: "Statutory and bank details",
      description:
        "UAN, ESI number, PAN, and where the salary is sent. None of it changes a payslip; all of it decides whether the PF return, the ESI return and the bank file can be filed at all.",
      component: lazy(() => import("./components/EmployeePayrollDetails")),
      order: 30,
    },
    {
      id: "employee-portal",
      title: "What employees see",
      description:
        "How much of their own pay a person can open. One of these is refused by the database and two are matters of layout, and the screen says which is which — a switch that only hides a link is not a permission.",
      component: lazy(() => import("./components/EmployeePortal")),
      order: 40,
    },
  ],

  /**
   * Six reports, which are the six sheets of the workbook this replaces.
   *
   * Administrators only, like Leave's — every one of them is the whole
   * workspace's pay at once. The rule is not enforced here: `pay_run_lines`
   * refuses a non-administrator itself, because a screen that is merely not
   * linked is not a permission.
   */
  reports: () => [
    {
      id: "salary-register",
      title: "Salary register",
      description:
        "Every person and every figure for one month. The sheet everything else derives from.",
      component: lazy(() => import("./components/SalaryRegisterReport")),
      order: 10,
    },
    {
      id: "bank-statement",
      title: "Bank statement",
      description:
        "Who to pay and into which account. Nothing else — a salary breakdown is not the bank's business.",
      component: lazy(() => import("./components/BankStatementReport")),
      order: 20,
    },
    {
      id: "pf-ecr",
      title: "Provident fund (ECR)",
      description: "The PF return in the EPFO's own column names, ready to convert for upload.",
      component: lazy(() => import("./components/PfReport")),
      order: 30,
    },
    {
      id: "esi",
      title: "Employee state insurance",
      description:
        "Only the people actually covered. Anybody above the wage ceiling is named as exempt, not filed as a nought.",
      component: lazy(() => import("./components/EsiReport")),
      order: 40,
    },
    {
      id: "professional-tax",
      title: "Professional tax — Karnataka",
      description: "Who paid professional tax this month, on the Karnataka slab.",
      component: lazy(() => import("./components/PtReport")),
      order: 50,
    },
    {
      id: "department-summary",
      title: "Department summary",
      description:
        "What each department cost. Derived from the run itself, so it cannot disagree with it.",
      component: lazy(() => import("./components/DepartmentSummaryReport")),
      order: 60,
    },
  ],

  // Registered with the Approval Engine, which knows nothing about payroll and
  // would happily let a second module claim the same string.
  approvalEntityTypes: ["pay_run"],

  approvalViews: () => [
    {
      entityType: "pay_run",
      component: lazy(() => import("./components/PayRunApprovalCard")),
    },
  ],

  // Emitted through the platform. This module never sends an email.
  eventKeys: ["approval.submitted", "approval.decided", "approval.completed"],

  settingsSchema: PayrollSettings,

  ownedTables: [
    "salary_components",
    "payroll_employee_details",
    "salary_structures",
    "salary_structure_lines",
    "pay_runs",
    "pay_run_days",
    "pay_run_lines",
  ],
};

export {
  openRun,
  computeRun,
  submitRun,
  getRunInputs,
  getRunLines,
  listRuns,
  listComponents,
  listStructures,
  listEmployeePayroll,
  getPayrollSettings,
  savePayrollSettings,
  getPayDate,
  previewPayDate,
  getDaysBasis,
  saveComponent,
  saveDays,
  saveStructure,
  saveEmployeePayroll,
  type ComputeResult,
} from "./handlers";

export {
  ComponentInput,
  DaysInput,
  EmployeePayrollInput,
  StructureInput,
  PayrollSettings,
  PayScheduleInput,
  EmployeePortalInput,
  PAY_RUN_STATUSES,
  payrollErrorMessage,
  type EmployeePayrollRow,
  type PayRunStatus,
  type PayRunSummary,
  type PayslipLine,
  type SalaryComponent,
  type StructureRow,
} from "./contracts";

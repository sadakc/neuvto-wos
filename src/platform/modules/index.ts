/**
 * Platform · Modules
 *
 * The only import path for the module system. Nothing outside this directory
 * reaches into its internals.
 */

export {
  installModules,
  allModules,
  moduleByKey,
  getEnabledModules,
  getModuleNavigation,
  resolveModuleRoute,
  getDashboardCards,
  getAdminSections,
  getModuleReports,
  getApprovalViews,
  getNotificationLinks,
  getHomeQueues,
} from "./registry";

export {
  ModuleDefinitionSchema,
  type ModuleDefinition,
  type ModuleNavItem,
  type ModuleSection,
  type ModuleRoute,
  type ModuleDashboardCard,
  type ModuleAdminSection,
  type ModuleReport,
  type ModuleApprovalView,
  type ModuleApprovalViewProps,
  type ModuleHomeQueue,
} from "./contract";

export { ModuleLink } from "./ModuleLink";
export { OrgModules } from "./OrgModules";

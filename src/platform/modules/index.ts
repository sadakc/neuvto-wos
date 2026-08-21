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
  getModuleAdminSections,
  getModuleReports,
  getApprovalViews,
} from "./registry";

export {
  ModuleDefinitionSchema,
  type ModuleDefinition,
  type ModuleNavItem,
  type ModuleRoute,
  type ModuleDashboardCard,
  type ModuleAdminSection,
  type ModuleReport,
  type ModuleApprovalView,
  type ModuleApprovalViewProps,
} from "./contract";

export { ModuleLink } from "./ModuleLink";
export { OrgModules } from "./OrgModules";

export { getModuleSettings, saveModuleSettings } from "./settings";

export {
  ORGANISATION_SCOPE,
  organisationScope,
  moduleScope,
  getWorkspaceScopes,
  getUnavailableScopes,
  scopeForPath,
  type WorkspaceScope,
  type UnavailableScope,
} from "./scopes";

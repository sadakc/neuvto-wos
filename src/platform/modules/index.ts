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
} from "./registry";

export {
  ModuleDefinitionSchema,
  type ModuleDefinition,
  type ModuleNavItem,
  type ModuleRoute,
  type ModuleDashboardCard,
} from "./contract";

export { ModuleLink } from "./ModuleLink";

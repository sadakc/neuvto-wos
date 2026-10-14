/**
 * Platform · Shell
 *
 * The Core HR navigation: the module rail, the adaptive tab bar and the frame
 * around every `/app` screen (DESIGN_SYSTEM §6–7).
 */

export { AppFrame } from "./AppFrame";
export { buildShell, groupBySection, locate, tabSearch, HOME_KEY, ORG_KEY } from "./model";
export type { ShellModule, ShellTab, TabGroup } from "./model";
export { fitTabs, fitRail, railMode, PICK_WIDTH } from "./fit";
export { TabBar, hiddenNote } from "./TabBar";
export { ModuleRail } from "./ModuleRail";
export { NavPanel } from "./NavPanel";

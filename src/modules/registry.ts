/**
 * The installed modules.
 *
 * **This is the only file outside a module folder that names a module.**
 * Enforced in CI — nothing else may import `@/modules/*`.
 *
 * That indirection is the whole mechanism. Adding a module is a folder and one
 * line here; removing it is deleting both, and CI proves the application still
 * builds afterwards. Without it, a module's name ends up in a navigation file, a
 * route table and a settings switch, and removing it becomes a search across the
 * codebase — which is what happened to `components/shared/app-nav.tsx` before
 * this existed.
 *
 * Keep this file trivial. Anything clever here is coupling by another name.
 */

import type { ModuleDefinition } from "@/platform/modules";

export const MODULES: readonly ModuleDefinition[] = [];

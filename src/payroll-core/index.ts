/**
 * Payroll arithmetic — the package's entire public surface.
 *
 * A peer of `src/platform/` and `src/modules/`, and deliberately not inside
 * either. Nothing here may import from anywhere else in the repository, which
 * ESLint enforces (`eslint.config.js`). That rule is what keeps the engine
 * testable without a database and portable to a native client later.
 */

export { computePayRun, computeEmployee, DEFAULT_POLICY } from "./engine";
export { round0, roundUp0 } from "./money";
export type {
  ComponentDefinition,
  FixedComponentAmount,
  EmployeeInput,
  PayrollPolicy,
  EarnedComponent,
  PayrollLine,
  PayrollTotals,
  DepartmentTotals,
  PayRunResult,
} from "./types";

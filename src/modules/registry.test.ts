/**
 * The modules that are actually installed, validated as the platform validates
 * them.
 *
 * `modules.test.ts` proves the registry rejects a malformed manifest — using
 * manifests it invents. Nothing checked the REAL ones. A bad route path or an
 * approval view for an entity type the module never claimed would therefore
 * surface as `installModules` throwing at startup: a blank application, in the
 * browser, on whichever machine ran it first.
 *
 * This is also the check the browser cannot do here. Every payroll screen sits
 * behind a sign-in, so "does /app/payroll resolve" is not answerable without
 * credentials — but "is the manifest the router will resolve from well-formed"
 * is, and that is the part that breaks.
 */

import { describe, expect, it } from "vitest";
import { ModuleDefinitionSchema } from "@/platform/modules";
import { MODULES } from "./registry";

describe("the installed modules", () => {
  it.each(MODULES.map((m) => [m.key, m] as const))(
    "%s has a manifest the platform accepts",
    (_key, module) => {
      expect(() => ModuleDefinitionSchema.parse(module)).not.toThrow();
    },
  );

  it("has both modules installed", () => {
    expect(MODULES.map((m) => m.key).sort()).toEqual(["leave", "payroll"]);
  });

  it("claims no key or route twice", () => {
    const keys = MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);

    const paths = MODULES.flatMap((m) => m.routes.map((r) => r.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("claims no approval entity type twice", () => {
    const types = MODULES.flatMap((m) => m.approvalEntityTypes);
    expect(new Set(types).size).toBe(types.length);
  });

  /**
   * A view registered for a string the module never claimed silently never
   * renders — the approvals queue asks "who draws THIS row" and nobody answers,
   * so a pending decision disappears from the only screen that would surface it.
   */
  it("registers approval views only for entity types the module claimed", () => {
    for (const module of MODULES) {
      for (const view of module.approvalViews?.(null) ?? []) {
        expect(module.approvalEntityTypes).toContain(view.entityType);
      }
    }
  });

  it("gives every report and admin section a unique id within its module", () => {
    for (const module of MODULES) {
      const reportIds = (module.reports?.(null) ?? []).map((r) => r.id);
      expect(new Set(reportIds).size, `${module.key} reports`).toBe(reportIds.length);

      const sectionIds = (module.adminSections?.(null) ?? []).map((s) => s.id);
      expect(new Set(sectionIds).size, `${module.key} admin sections`).toBe(sectionIds.length);
    }
  });
});

describe("payroll's declared surface", () => {
  const payroll = MODULES.find((m) => m.key === "payroll");

  it("is installed", () => {
    expect(payroll).toBeDefined();
  });

  it("contributes the six reports that replace the workbook's six sheets", () => {
    expect((payroll?.reports?.(null) ?? []).map((r) => r.id)).toEqual([
      "salary-register",
      "bank-statement",
      "pf-ecr",
      "esi",
      "professional-tax",
      "department-summary",
    ]);
  });

  it("claims pay_run, and renders it", () => {
    expect(payroll?.approvalEntityTypes).toEqual(["pay_run"]);
    expect((payroll?.approvalViews?.(null) ?? []).map((v) => v.entityType)).toEqual(["pay_run"]);
  });

  /**
   * Every table the payroll migrations create. Removing the module drops these,
   * so a table missing here survives a removal the verification script has just
   * declared clean.
   */
  it("owns every table its migrations create", () => {
    expect([...(payroll?.ownedTables ?? [])].sort()).toEqual([
      "pay_run_days",
      "pay_run_lines",
      "pay_runs",
      "payroll_employee_details",
      "salary_components",
      "salary_structure_lines",
      "salary_structures",
      "salary_template_lines",
      "salary_templates",
    ]);
  });

  it("routes payslips somewhere every employee can reach", () => {
    expect(payroll?.routes.map((r) => r.path)).toContain("payroll/payslips");
  });
});

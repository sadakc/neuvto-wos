/**
 * Where this module's notices open from the bell (D111), from the manifest
 * the platform reads.
 */

import { describe, expect, it } from "vitest";
import { employee } from "./index";

const link = (event: string, payload: Record<string, unknown> = {}) =>
  employee.notificationLinks?.[event]?.(payload);

describe("the Employee Card's notices", () => {
  it("open the screen each is about", () => {
    expect(link("employee.change_requested")).toBe("/app/employee/change-requests");
    // Sada, 27 Oct 2026: the section each is about, not just the page.
    expect(link("employee.change_resolved")).toBe("/app/employee#my-change-requests");
    expect(link("employee.changed_own_record", { employee_id: "e1" })).toBe(
      "/app/employee/directory/person?id=e1",
    );
    expect(link("employee.onboarding_overdue")).toBe("/app/employee/add");
    // D112: what your own record still needs opens your own card, at the
    // section holding the first thing it needs.
    expect(link("employee.your_record_needs", { items: "date of birth, uan" })).toBe(
      "/app/employee#section-personal",
    );
    expect(link("employee.your_record_needs", { items: "uan, bank account" })).toBe(
      "/app/employee#section-statutory",
    );
    expect(link("employee.your_record_needs", { items: "nominees totalling 100%" })).toBe(
      "/app/employee#section-family",
    );
    expect(link("employee.your_record_needs", { items: "emergency contact" })).toBe(
      "/app/employee#section-overview",
    );
    expect(link("employee.your_record_needs", { items: "present address" })).toBe(
      "/app/employee#section-history",
    );
  });

  it("claim every event the module emits", () => {
    for (const e of employee.eventKeys) expect(link(e), e).toBeTruthy();
  });
});

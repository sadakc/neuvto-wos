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
    expect(link("employee.change_resolved")).toBe("/app/employee");
    expect(link("employee.changed_own_record", { employee_id: "e1" })).toBe(
      "/app/employee/directory/person?id=e1",
    );
    expect(link("employee.onboarding_overdue")).toBe("/app/employee/add");
    // D112: what your own record still needs opens your own card.
    expect(link("employee.your_record_needs")).toBe("/app/employee");
  });

  it("claim every event the module emits", () => {
    for (const e of employee.eventKeys) expect(link(e), e).toBeTruthy();
  });
});

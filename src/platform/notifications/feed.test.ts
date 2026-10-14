/**
 * Where a notice in the bell opens (D111). The module a notice is about says
 * where; the platform answers for approvals waiting on you; anything else is
 * Home. And when it happened, in words.
 */

import { describe, expect, it } from "vitest";
import { noticeLink, whenText, type LinkContext } from "./feed";

const ctx: LinkContext = {
  links: new Map([
    ["employee.change_requested", () => "/app/employee/change-requests"],
    [
      "employee.changed_own_record",
      (p: Record<string, unknown>) => `/app/employee/directory/person?id=${String(p.employee_id)}`,
    ],
  ]),
  moduleOfEntity: new Map([["leave_request", "leave"]]),
  linksByModule: new Map([
    ["leave", { "approval.decided": () => "/app/leave", "approval.completed": () => "/app/leave" }],
  ]),
};
const link = (eventKey: string, payload: Record<string, unknown> = {}) =>
  noticeLink({ eventKey, payload }, ctx);

describe("where a notice opens", () => {
  it("goes where the module says for its own events, with what the payload names", () => {
    expect(link("employee.change_requested")).toBe("/app/employee/change-requests");
    expect(link("employee.changed_own_record", { employee_id: "e1" })).toBe(
      "/app/employee/directory/person?id=e1",
    );
  });

  it("opens the module's approvals for a request waiting on you", () => {
    for (const e of ["approval.submitted", "approval.escalated", "approval.delegated"]) {
      expect(link(e, { entity_type: "leave_request" })).toBe("/app/approvals?m=leave");
    }
  });

  it("opens the module's own screen for a decision about your request", () => {
    expect(link("approval.decided", { entity_type: "leave_request" })).toBe("/app/leave");
    expect(link("approval.completed_fyi", { entity_type: "leave_request" })).toBe("/app/leave");
  });

  it("does not send a copy for your information to a queue that is not yours", () => {
    expect(link("approval.submitted_fyi", { entity_type: "leave_request" })).toBe("/app");
  });

  it("opens Home's approvals when nothing claims the entity, and Home for anything unknown", () => {
    expect(link("approval.submitted", { entity_type: "gone_module_thing" })).toBe("/app/approvals");
    expect(link("something.else")).toBe("/app");
  });
});

describe("when it happened", () => {
  const now = new Date(2026, 9, 14, 15, 0);
  it("says it in words", () => {
    expect(whenText(new Date(2026, 9, 14, 14, 59, 40).toISOString(), now)).toBe("just now");
    expect(whenText(new Date(2026, 9, 14, 14, 55).toISOString(), now)).toBe("5 min ago");
    expect(whenText(new Date(2026, 9, 14, 12, 0).toISOString(), now)).toBe("3 h ago");
    expect(whenText(new Date(2026, 9, 13, 18, 0).toISOString(), now)).toBe("yesterday");
    expect(whenText(new Date(2026, 9, 10, 9, 0).toISOString(), now)).not.toMatch(/ago|yesterday/);
  });
});

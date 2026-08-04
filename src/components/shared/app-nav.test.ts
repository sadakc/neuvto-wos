/**
 * The mobile tab bar's arithmetic.
 *
 * `items.slice(0, 5)` silently deleted every destination past the fifth: on a
 * phone an administrator had no route to Approval rules or Settings, and
 * nothing on screen said so. A missing feature and a hidden feature look
 * identical to the person using it, which is why this is tested at the seam
 * rather than left to a glance at the screen.
 */

import { describe, expect, it } from "vitest";
import { mergeNavItems, platformNavItems, splitNavItems } from "./app-nav";
import { MAX_VISIBLE_TABS } from "@/platform/design/tokens";
import type { CurrentUser } from "@/platform/auth";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Item ${i + 1}`, to: `/app/${i + 1}` }));

describe("splitNavItems", () => {
  it("shows everything when it fits", () => {
    for (let n = 0; n <= MAX_VISIBLE_TABS; n++) {
      const { visible, overflow } = splitNavItems(items(n));
      expect(visible).toHaveLength(n);
      expect(overflow).toEqual([]);
    }
  });

  it("keeps a slot for More once it does not fit", () => {
    // Six items into five slots is FOUR plus More, not five plus More.
    const { visible, overflow } = splitNavItems(items(6));
    expect(visible).toHaveLength(MAX_VISIBLE_TABS - 1);
    expect(overflow.map((i) => i.label)).toEqual(["Item 5", "Item 6"]);
  });

  it("never renders more than the cap, counting More", () => {
    for (let n = 0; n <= 12; n++) {
      const { visible, overflow } = splitNavItems(items(n));
      const rendered = visible.length + (overflow.length > 0 ? 1 : 0);
      expect(rendered, `${n} items rendered ${rendered} tabs`).toBeLessThanOrEqual(
        MAX_VISIBLE_TABS,
      );
    }
  });

  it("loses nothing, whatever the count", () => {
    // The property that actually matters. Every destination is reachable from
    // one of the two lists, in its original order.
    for (let n = 0; n <= 12; n++) {
      const all = items(n);
      const { visible, overflow } = splitNavItems(all);
      expect([...visible, ...overflow]).toEqual(all);
    }
  });
});

describe("an administrator can reach every screen from a phone", () => {
  // The regression in its original clothes: this is the person the old slice
  // stranded, and these are the destinations it ate.
  const admin = {
    id: "u1",
    email: "admin@acme.test",
    roles: ["org_admin"],
    organizationId: "o1",
    organizationName: "Acme",
  } as unknown as CurrentUser;

  const leaveModule = [
    { label: "Apply", to: "/app/leave/apply" },
    { label: "My leave", to: "/app/leave" },
    { label: "Calendar", to: "/app/leave/calendar" },
  ];

  it("reaches Approval rules and Settings", () => {
    const all = mergeNavItems(platformNavItems(admin), leaveModule);
    const { visible, overflow } = splitNavItems(all);
    const reachable = [...visible, ...overflow].map((i) => i.label);

    expect(all.length).toBeGreaterThan(MAX_VISIBLE_TABS); // else this proves nothing
    for (const label of ["Approval rules", "Settings", "Reports", "Approvals"]) {
      expect(reachable, `${label} is unreachable on mobile`).toContain(label);
    }
  });

  it("keeps their own leave on the bar rather than behind More", () => {
    // An administrator is also an employee, and their own leave is what they
    // reach for most. Admin destinations are the ones that belong in More.
    const { visible } = splitNavItems(mergeNavItems(platformNavItems(admin), leaveModule));
    expect(visible.map((i) => i.label)).toContain("Apply");
    expect(visible.map((i) => i.label)).toContain("My leave");
  });
});

describe("an ordinary employee", () => {
  const employee = {
    id: "u2",
    email: "sam@acme.test",
    roles: ["employee"],
    organizationId: "o1",
    organizationName: "Acme",
  } as unknown as CurrentUser;

  it("gets no More button at all", () => {
    // Dashboard + three Leave destinations = four. A "More" leading to an empty
    // sheet is worse than no button.
    const all = mergeNavItems(platformNavItems(employee), [
      { label: "Apply", to: "/app/leave/apply" },
      { label: "My leave", to: "/app/leave" },
      { label: "Calendar", to: "/app/leave/calendar" },
    ]);
    const { visible, overflow } = splitNavItems(all);
    expect(overflow).toEqual([]);
    expect(visible).toHaveLength(4);
  });
});

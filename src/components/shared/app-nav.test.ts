/**
 * The mobile tab bar's arithmetic.
 *
 * `items.slice(0, 5)` silently deleted every destination past the fifth: on a
 * phone an administrator had no route to Approval rules or Configurations, and
 * nothing on screen said so. A missing feature and a hidden feature look
 * identical to the person using it, which is why this is tested at the seam
 * rather than left to a glance at the screen.
 *
 * Scoping the shell was NOT allowed to retire this. No single scope carries the
 * whole workspace any more, which makes an overflow less likely — and a cap
 * respected only because nothing currently exceeds it is a cap nobody is
 * enforcing. The organisation scope still hands an administrator six.
 */

import { describe, expect, it } from "vitest";
import { splitNavItems } from "./app-nav";
import { organisationScope } from "@/platform/modules";
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
  // stranded, and these are the destinations it ate. They are all in the
  // organisation scope now, which is still one more than the bar holds.
  const admin = {
    id: "u1",
    email: "admin@acme.test",
    roles: ["org_admin"],
    organizationId: "o1",
    organizationName: "Acme",
  } as unknown as CurrentUser;

  it("reaches Approval rules and Configurations", () => {
    const all = organisationScope(admin).items;
    const { visible, overflow } = splitNavItems([...all]);
    const reachable = [...visible, ...overflow].map((i) => i.label);

    expect(all.length).toBeGreaterThan(MAX_VISIBLE_TABS); // else this proves nothing
    for (const label of ["Approval rules", "Configurations", "Reports", "Approvals"]) {
      expect(reachable, `${label} is unreachable on mobile`).toContain(label);
    }
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
    // One destination in the organisation scope. A "More" leading to an empty
    // sheet is worse than no button — and this is now true by construction
    // rather than by counting, which is the point of the scopes.
    const { visible, overflow } = splitNavItems([...organisationScope(employee).items]);
    expect(overflow).toEqual([]);
    expect(visible.map((i) => i.label)).toEqual(["Dashboard"]);
  });
});

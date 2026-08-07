/**
 * The department handlers, with the database mocked.
 *
 * These cover the half a render test cannot: the mapping from a Postgres
 * refusal to a sentence, and the head count that is assembled in TypeScript
 * rather than in SQL. `members.test.ts` exists for the same reason — proving a
 * message reaches the screen is not proving the thing that produced it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  /** Keyed by table, so the two reads in listDepartments can differ. */
  tables: {} as Record<string, { data: unknown[]; error: unknown }>,
  rpc: { data: null as unknown, error: null as { message: string } | null },
  lastInsert: null as unknown,
  lastUpdate: null as unknown,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const result = () => Promise.resolve(calls.tables[table] ?? { data: [], error: null });
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => result(),
      then: (...a: unknown[]) => result().then(...(a as [])),
      insert: (row: unknown) => {
        calls.lastInsert = row;
        return result();
      },
      update: (row: unknown) => {
        calls.lastUpdate = row;
        return builder;
      },
    };
    return builder;
  };
  return {
    supabase: {
      from,
      rpc: () => Promise.resolve(calls.rpc),
    },
  };
});

const { listDepartments, saveDepartment, removeDepartment, setDepartment } =
  await import("./index");

beforeEach(() => {
  calls.tables = {};
  calls.rpc = { data: null, error: null };
  calls.lastInsert = null;
  calls.lastUpdate = null;
});

describe("listDepartments", () => {
  it("counts the people in each one", async () => {
    calls.tables.departments = {
      data: [
        { id: "ops", name: "Operations", parent_department_id: null },
        { id: "sales", name: "Sales", parent_department_id: null },
        { id: "empty", name: "Facilities", parent_department_id: null },
      ],
      error: null,
    };
    calls.tables.profiles = {
      data: [
        { department_id: "ops" },
        { department_id: "ops" },
        { department_id: "sales" },
        // Somebody in no department at all — the normal case in a workspace
        // that has just configured its first one.
        { department_id: null },
      ],
      error: null,
    };

    const got = await listDepartments();
    expect(got.map((d) => [d.name, d.memberCount])).toEqual([
      ["Operations", 2],
      ["Sales", 1],
      ["Facilities", 0],
    ]);
  });

  it("says zero rather than nothing for a department with nobody in it", async () => {
    // The empty state on the row reads "Nobody in it yet", which needs a 0 and
    // not an undefined — `undefined === 0` is false and the row would show the
    // wrong branch.
    calls.tables.departments = {
      data: [{ id: "ops", name: "Operations", parent_department_id: null }],
      error: null,
    };
    calls.tables.profiles = { data: [], error: null };
    expect((await listDepartments())[0].memberCount).toBe(0);
  });

  it("throws rather than returning an empty list when the read fails", async () => {
    // An empty list means "no departments configured" and is a legitimate state
    // the screen renders a specific message for. A failed read must not be
    // mistaken for it.
    calls.tables.departments = { data: [], error: { message: "boom" } };
    await expect(listDepartments()).rejects.toThrow();
  });
});

describe("saveDepartment", () => {
  it("puts the caller's own organisation on a new one", async () => {
    // Never from the form. A client-supplied organization_id is a cross-tenant
    // write waiting for the one policy that forgets to check it.
    await saveDepartment({ name: "Operations" }, "org-1");
    expect(calls.lastInsert).toEqual({ organization_id: "org-1", name: "Operations" });
  });

  it("trims the name before storing it", async () => {
    await saveDepartment({ name: "  Operations  " }, "org-1");
    expect(calls.lastInsert).toMatchObject({ name: "Operations" });
  });

  it("refuses a blank name", async () => {
    await expect(saveDepartment({ name: "   " }, "org-1")).rejects.toThrow();
  });

  it("says a name is taken rather than showing an index", async () => {
    calls.tables.departments = {
      data: [],
      error: { code: "23505", message: "uq_department_name" },
    };
    await expect(saveDepartment({ name: "Sales" }, "org-1")).rejects.toThrow(
      /already a department with that name/i,
    );
  });
});

describe("removeDepartment", () => {
  it("reports how many people it took out", async () => {
    calls.rpc = { data: { people_unassigned: 3 }, error: null };
    expect(await removeDepartment("ops")).toEqual({ peopleUnassigned: 3 });
  });

  it("treats a missing count as zero rather than as undefined", async () => {
    // The notice reads "N people are no longer in a department". `undefined`
    // there is a sentence with a hole in it.
    calls.rpc = { data: {}, error: null };
    expect(await removeDepartment("ops")).toEqual({ peopleUnassigned: 0 });
  });

  it("explains a department that has departments inside it", async () => {
    calls.rpc = { data: null, error: { message: "DEPARTMENT_HAS_CHILDREN" } };
    await expect(removeDepartment("sales")).rejects.toThrow(/departments inside it/i);
  });
});

describe("setDepartment", () => {
  it("explains a department that is gone", async () => {
    // The same code the database raises for another tenant's department — which
    // is deliberate. D40: an administrator is never told that an id belongs to
    // somebody else's workspace, only that it is not theirs.
    calls.rpc = { data: null, error: { message: "DEPARTMENT_NOT_FOUND" } };
    await expect(setDepartment("emp", "alien")).rejects.toThrow(/no longer exists/i);
  });

  it("accepts null, which is how somebody is taken out of one", async () => {
    await expect(setDepartment("emp", null)).resolves.toBeUndefined();
  });
});

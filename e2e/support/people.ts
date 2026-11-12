/**
 * The seeded people the tests sign in as (neuvto-harness/seed). One saved
 * session each, made by global-setup, so a test starts already signed in.
 */

export const PEOPLE = {
  /** HR Admin: the Employee Admin, who configures and edits records. */
  hr: { email: "hema.hr@acme.test", name: "Hema HR" },
  /** An ordinary employee. Reports to Mark. */
  employee: { email: "priya.emp@acme.test", name: "Priya Employee" },
  /** Priya's and Ravi's manager, so their leave reaches him. */
  manager: { email: "mark.manager@acme.test", name: "Mark Manager" },
  /** Priya's colleague, whose card others look at. */
  colleague: { email: "ravi.emp@acme.test", name: "Ravi Employee" },
  /** Acme's Super Admin: the one who sets which fields are required (D107). */
  superAdmin: { email: "alice.admin@acme.test", name: "Alice Admin" },
} as const;

export type Role = keyof typeof PEOPLE;

/** Sessions for the device lab are for a different address and database, so kept apart. */
export const sessionFile = (role: Role) =>
  `e2e/${process.env.DEVICE_LAB ? ".auth-lab" : ".auth"}/${role}.json`;

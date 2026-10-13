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
} as const;

export type Role = keyof typeof PEOPLE;

export const sessionFile = (role: Role) => `e2e/.auth/${role}.json`;

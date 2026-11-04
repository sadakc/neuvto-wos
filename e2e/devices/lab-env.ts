import { execFileSync } from "node:child_process";

/**
 * The device lab's addresses, put into the environment before anything reads
 * them: e2e/support/local.ts fixes its database and mail addresses when it is
 * first imported, and would otherwise point at the local stack Sada tests on.
 * Imported first, for that reason.
 */
export const lab = Object.fromEntries(
  [
    ...execFileSync("bash", ["scripts/device-lab.sh", "env"], { encoding: "utf8" }).matchAll(
      /^export (\w+)=(.*)$/gm,
    ),
  ].map((m) => [m[1], m[2]]),
);
Object.assign(process.env, lab);

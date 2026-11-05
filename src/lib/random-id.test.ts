import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id";

describe("a random id for a file's name", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a version-4 UUID", () => {
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is different each time", () => {
    expect(new Set(Array.from({ length: 50 }, randomId)).size).toBe(50);
  });

  it("works on a page that is not secure, where randomUUID is missing (a phone on the LAN)", () => {
    const real = globalThis.crypto;
    // What a phone on http://192.168.x.x has: getRandomValues, no randomUUID.
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });
});

describe("the app's own code", () => {
  it("never calls crypto.randomUUID, which a phone on the LAN does not have", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (
          /\.(ts|tsx)$/.test(name) &&
          !/\.test\./.test(name) &&
          !p.endsWith("random-id.ts")
        ) {
          if (/crypto\.randomUUID\(/.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

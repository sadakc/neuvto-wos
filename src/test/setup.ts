/**
 * Test setup, loaded for every file.
 *
 * Deliberately tiny, and deliberately safe to load in the `node` environment:
 * most tests here are pure functions and must not pay for a DOM. Anything that
 * touches `document` is guarded, so this file works in both environments rather
 * than needing two.
 */

import { afterAll, afterEach } from "vitest";

// ─────────────────────────────────────────────── no test may reach the network
//
// A render test that forgets to mock its data layer does not fail. The component
// catches its own error, renders an empty state, and the assertions pass — so
// the suite is green for a reason that has nothing to do with what it claims to
// prove. That has already happened once here.
//
// WHERE IT WOULD REACH IS THE PART WORTH KNOWING. `.env` is committed and names
// PRODUCTION; `.env.local` names localhost and is gitignored. So the same
// unmocked test resolves differently in the two places it runs:
//
//     locally            http://127.0.0.1:54321
//     in CI              https://udrzhfgwqgolvyimbwto.supabase.co   ← production
//
// Verified by moving `.env.local` aside and re-resolving. Nothing is writable
// without a session — `anon` executes nothing since the 2 Aug open relay — but a
// test suite that talks to the live customer database at all is not a thing to
// leave to whoever remembers `vi.mock` next time.
//
// Reported in afterAll rather than afterEach on purpose: the request a component
// fires from `useEffect` usually lands AFTER the test that triggered it has
// finished, so a per-test check sees an empty list and reports nothing.
const networkCalls: string[] = [];

function blocked(what: string, url: unknown): Error {
  networkCalls.push(`${what} ${String(url).slice(0, 120)}`);
  return new Error(
    `Tests must not use the network. Mock the module that called ${what} ${String(url).slice(0, 80)}`,
  );
}

globalThis.fetch = ((...args: unknown[]) =>
  Promise.reject(blocked("fetch", args[0]))) as typeof fetch;

globalThis.XMLHttpRequest = class {
  open(_method: string, url: string) {
    throw blocked("XMLHttpRequest", url);
  }
  send() {}
  setRequestHeader() {}
  addEventListener() {}
} as unknown as typeof XMLHttpRequest;

globalThis.WebSocket = class {
  constructor(url: string) {
    throw blocked("WebSocket", url);
  }
} as unknown as typeof WebSocket;

afterAll(() => {
  const seen = [...new Set(networkCalls)];
  networkCalls.length = 0;
  if (seen.length === 0) return;
  throw new Error(
    `This file reached the network ${seen.length} time(s), so at least one test ` +
      `is passing for the wrong reason:\n  ${seen.join("\n  ")}\n\n` +
      `In CI that address is the PRODUCTION database — see the comment in src/test/setup.ts.`,
  );
});

if (typeof document !== "undefined") {
  // ─────────────────────────────────── localStorage, whose name node 26 took
  //
  // Node 26 ships its own experimental `localStorage`, gated behind
  // `--localstorage-file`. Without that flag the global still EXISTS — as an
  // accessor on `globalThis` that reads `undefined` — and because the name is
  // already taken, vitest's happy-dom setup never installs the real one over
  // it. A happy-dom file then gets a working `window` and a working `document`
  // and no storage at all, so the first `localStorage.clear()` throws "Cannot
  // read properties of undefined". That is what upgrading Homebrew node to
  // 26.7.0 did to idle.test.ts on 19 Aug 2026, sixteen tests at a time.
  //
  // `window.localStorage` is NOT a way round it: under vitest `window` IS
  // `globalThis`, so it is the very same shadowed lookup — checked, not
  // assumed. Nor is passing `--localstorage-file`, which opts the whole suite
  // into an experimental node feature in order to satisfy a test.
  //
  // What goes back is happy-dom's own `Storage`, still reachable under that
  // name because node does not claim it too. Using the real class rather than
  // a hand-written stub is the point: `getItem` on a missing key is null,
  // values are coerced to strings, and `length` / `key()` / `clear()` behave
  // as they do in a browser. A stub here would have to be right about all of
  // that, and would drift from the thing it stands in for.
  //
  // This file runs once per test FILE, so the store is fresh per file exactly
  // as happy-dom's own would have been — no state crosses between them.
  //
  // The guard means this is a no-op wherever happy-dom still wins, which today
  // includes CI: it sets up bun and never sets up node, so it inherits the
  // runner's older one. When GitHub's runners reach node 26 this is already
  // fixed rather than newly broken.
  if (typeof localStorage === "undefined" && typeof Storage === "function") {
    Object.defineProperty(globalThis, "localStorage", {
      value: new Storage(),
      configurable: true,
      writable: true,
    });
  }

  // Name the missing global, in a sentence.
  //
  // The failure above arrived as a TypeError repeated once per test, pointing
  // at the line that touched the global rather than at the runtime that had
  // removed it. Whatever a future runtime claims next should announce itself
  // here, once, instead of being diagnosed from sixteen identical stack traces.
  const required = ["window", "document", "localStorage", "sessionStorage"];
  for (const name of required) {
    if (typeof (globalThis as unknown as Record<string, unknown>)[name] === "undefined") {
      throw new Error(
        `This file asked for the happy-dom environment, but \`${name}\` is missing.\n` +
          `A DOM global whose name the RUNTIME has taken is the usual cause — node 26 ` +
          `does exactly that to \`localStorage\` unless \`--localstorage-file\` is passed.\n` +
          `Check \`node --version\`, then see the comment above this check in src/test/setup.ts.`,
      );
    }
  }

  // jest-dom's matchers (toBeInTheDocument, toHaveValue, …). Imported lazily so
  // the node-environment tests never load it.
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");

  // Unmount between tests. Without this a component from the previous test is
  // still in the document, and a query that should find one element finds two —
  // which fails in a way that points at the wrong test.
  afterEach(() => cleanup());
}

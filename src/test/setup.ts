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
  // jest-dom's matchers (toBeInTheDocument, toHaveValue, …). Imported lazily so
  // the node-environment tests never load it.
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");

  // Unmount between tests. Without this a component from the previous test is
  // still in the document, and a query that should find one element finds two —
  // which fails in a way that points at the wrong test.
  afterEach(() => cleanup());
}

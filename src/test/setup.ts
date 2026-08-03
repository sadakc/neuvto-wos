/**
 * Test setup, loaded for every file.
 *
 * Deliberately tiny, and deliberately safe to load in the `node` environment:
 * most tests here are pure functions and must not pay for a DOM. Anything that
 * touches `document` is guarded, so this file works in both environments rather
 * than needing two.
 */

import { afterEach } from "vitest";

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

/**
 * The one place this codebase leaves the router and reloads the page.
 *
 * `window.location.href = …` appears in eight places and had no seam, which is
 * the entire reason the `/auth` redirect had no test: happy-dom throws
 * "Not implemented: navigation" the moment anything assigns to it, so a test
 * cannot observe the destination — it can only observe a crash. One module the
 * test can mock in a line fixes that.
 *
 * A full reload rather than a router navigation is deliberate at these seams and
 * not laziness: crossing between signed-out and signed-in, or between a tenant
 * workspace and the platform console, should discard every cache, query client
 * and piece of component state. A client-side transition carries the previous
 * identity's data into the next identity's screens, and the failure is silent.
 */
export function hardNavigate(url: string): void {
  if (typeof window === "undefined") return;
  window.location.href = url;
}

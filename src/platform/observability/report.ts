import { supabase } from "@/integrations/supabase/client";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { fingerprint, messageOf, sanitizeRoute, scrubText, MAX_MESSAGE, MAX_STACK } from "./scrub";

/**
 * Where a production error actually goes.
 *
 * Until 4 Aug 2026 the answer was nowhere. `reportLovableError` forwards to
 * `window.__lovableEvents` and `window.__lovableReportRuntimeError`, and both are
 * undefined outside the Lovable editor preview — verified against the live site,
 * not assumed. So the root boundary caught a crash, rendered "This page didn't
 * load", and told no one. Code that reads as coverage and is not is worse than
 * an empty file, because it closes the question.
 *
 * This writes to `public.client_errors` through `record_client_error`. The
 * Lovable hook is still called, because inside the editor it is genuinely useful
 * and costs nothing when absent.
 *
 * ── two channels, chosen by whether there is a session
 *
 * `record_client_error` is granted to `authenticated` only, and that has not
 * changed: granting `anon` a database function is the exact shape of the open
 * relay found on production on 2 Aug 2026.
 *
 * It left a blind spot, and on 6 Aug 2026 the blind spot cost thirteen hours.
 * Resend started rejecting Supabase's SMTP login, sign-in was dead for every
 * address, and this store stayed empty throughout — because everybody hitting
 * it was anonymous, which is what "cannot sign in" means. A person found it.
 *
 * So a caller with no session goes to the `client-error` edge function instead,
 * which holds the service key and calls `record_public_client_error`. `anon`
 * still executes nothing. The two paths differ in ways worth knowing:
 *
 *   · the signed-in one attributes the error to an organisation, derived from
 *     the session and never from the client;
 *   · the public one cannot, and spends a SEPARATE daily ceiling — so flooding
 *     the public channel cannot suppress a customer's real errors.
 */

type Mechanism = "boundary" | "onerror" | "unhandledrejection" | "write_failed";

/**
 * Fingerprints already sent during this page load.
 *
 * Without it, a fault inside a render loop calls this on every frame: the
 * database would collapse them into one row, but the browser would still issue
 * thousands of requests and the user's tab would be slower for the reporting
 * than for the bug.
 */
const seen = new Set<string>();

/**
 * Distinct faults per page load. Twenty is well past "something is wrong" and
 * well short of a request storm.
 */
const MAX_PER_PAGE = 20;

/**
 * Reporting must never report itself.
 *
 * If the RPC fails — offline, session expired, the endpoint 500s — the failure
 * arrives as a rejected promise. Without this flag, a global `unhandledrejection`
 * handler catches it, calls this function, which fails again, forever. The tab
 * locks up and the only visible symptom is that the machine gets hot.
 */
let reporting = false;

export function resetReportingStateForTests() {
  seen.clear();
  reporting = false;
}

/**
 * Which channel to use.
 *
 * Reads the stored session rather than making a network call, so this costs
 * nothing on a page that is already broken.
 *
 * A failure here resolves to FALSE — the public channel — on purpose. The two
 * ways to be wrong are not symmetric: routing a signed-in caller to the public
 * endpoint loses the organisation attribution and spends the public budget,
 * while routing an anonymous one to the RPC loses the report entirely. Losing
 * the report is the failure this whole channel exists to stop.
 */
async function hasSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session);
  } catch {
    return false;
  }
}

export async function reportError(
  error: unknown,
  mechanism: Mechanism,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (typeof window === "undefined") return; // SSR: no session, no reporter
  if (reporting) return;

  // The editor preview hook. No-op in production, useful in the editor.
  reportLovableError(error, { mechanism, ...context });

  try {
    const rawMessage = messageOf(error);
    const rawStack = error instanceof Error ? error.stack : undefined;

    const message = scrubText(rawMessage).slice(0, MAX_MESSAGE);
    const stack = scrubText(rawStack).slice(0, MAX_STACK) || undefined;
    const route = sanitizeRoute(window.location?.pathname);
    const fp = fingerprint(rawMessage, rawStack);

    if (!message) return;
    if (seen.has(fp)) return;
    if (seen.size >= MAX_PER_PAGE) return;
    seen.add(fp);

    reporting = true;

    // Wired when the deploy pipeline supplies a commit sha. Without it, "is
    // this still happening after the fix" cannot be answered — worth doing,
    // and honestly absent today rather than faked.
    const release = import.meta.env?.VITE_COMMIT_SHA ?? undefined;
    const userAgent = navigator?.userAgent?.slice(0, 300);

    // Deliberately not awaited by callers and deliberately swallowed below. An
    // error handler that can itself fail visibly is not an error handler.
    if (await hasSession()) {
      await supabase.rpc("record_client_error", {
        p_fingerprint: fp,
        p_message: message,
        p_mechanism: mechanism,
        p_stack: stack ?? undefined,
        p_route: route,
        p_severity: "error",
        p_release: release,
        p_user_agent: userAgent,
      });
    } else {
      // No session: the RPC would refuse, and refusing is how the 6 Aug outage
      // stayed invisible. Unprefixed keys — the edge function maps them onto
      // the RPC's parameters, and it is the only thing that knows both shapes.
      await supabase.functions.invoke("client-error", {
        body: {
          fingerprint: fp,
          message,
          mechanism,
          stack: stack ?? undefined,
          route,
          severity: "error",
          release,
          user_agent: userAgent,
        },
      });
    }
  } catch {
    // Swallowed on purpose. There is nowhere left to report a reporting failure,
    // and rethrowing here turns one broken page into an infinite loop.
  } finally {
    reporting = false;
  }
}

/**
 * The two faults a React error boundary never sees.
 *
 * A boundary catches errors thrown during render. It does not catch an error in
 * an event handler, a `setTimeout`, or a rejected promise nobody awaited — which
 * between them are most of what actually breaks in this app, because most of it
 * is asynchronous calls to Postgres.
 *
 * Returns a teardown function so a test can install and remove cleanly.
 */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent) => {
    void reportError(event.error ?? event.message, "onerror");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    void reportError(event.reason, "unhandledrejection");
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

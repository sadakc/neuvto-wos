/**
 * What is removed from an error before it leaves the browser.
 *
 * The database scrubs again on arrival (`record_client_error`), and that pass is
 * the guarantee — it still holds when this file is an old cached bundle or
 * somebody has broken a regex here. This pass is the one that matters for a
 * different reason: it keeps the data out of the network request in the first
 * place, which is the difference between "we do not store employee addresses"
 * and "we do not transmit them".
 *
 * D42 is the rule being served: a platform admin never reads tenant data. An
 * error message is not abstract — "Cannot read balance for priya@customer.test"
 * is somebody's employee, and a stack trace happily carries whatever was
 * interpolated into it.
 */

/** Anything shaped like an email address. */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * International phone numbers. Wider than +91 on purpose: phone is India-only
 * by decision today, and the day that changes must not be the day this quietly
 * starts letting numbers through.
 */
const PHONE = /\+\d[\d\s-]{8,17}\d/g;

/** UUIDs — every id in this system is one, and an id identifies a person. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Long digit runs that are not a phone number: employee numbers, account
 * numbers, anything a customer decided to put in a field. Bounded at 7+ so it
 * cannot eat line numbers out of a stack trace, which are the part worth
 * keeping.
 */
const LONG_DIGITS = /\b\d{7,}\b/g;

/**
 * Bearer tokens and long opaque strings. Invitation tokens are the specific
 * worry — see `sanitizeRoute` — but a JWT can also end up in a message when a
 * fetch wrapper stringifies its own headers.
 */
const TOKENISH = /\b(?:eyJ[A-Za-z0-9_-]{10,}|sb_(?:publishable|secret)_[A-Za-z0-9_-]+)\b/g;

export function scrubText(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(EMAIL, "[address]")
    .replace(TOKENISH, "[token]")
    .replace(UUID, "[id]")
    .replace(PHONE, "[number]")
    .replace(LONG_DIGITS, "[digits]");
}

/**
 * A route, reduced to its shape.
 *
 * **The query string is dropped entirely, and that is the point of this
 * function rather than a detail of it.** An invitation is accepted at a URL
 * carrying a token, and a token is a credential: an error on that page would
 * otherwise write a live invitation token into a table, where it would sit until
 * it expired. Nothing is worth preserving on the other side of that trade — a
 * query string has never once helped identify a crash.
 *
 * Path ids become `:id` for the same two reasons at once: `/app/leave/<uuid>`
 * and `/app/leave/<other uuid>` are the same page and should group as one, and
 * the uuid was an employee.
 */
export function sanitizeRoute(pathname: string | undefined | null): string {
  if (!pathname) return "/";
  // Take the path only. Also drops the fragment, which is where OAuth
  // implicit-flow tokens live.
  const path = pathname.split("?")[0].split("#")[0];
  return (
    path
      .replace(UUID, ":id")
      // Numeric segments too — nothing here uses them today, but a future
      // /app/reports/2026 should not become its own error group every year.
      .replace(/\/\d+(?=\/|$)/g, "/:n")
      .slice(0, 200) || "/"
  );
}

/**
 * A stable grouping key for one fault.
 *
 * Built from the scrubbed message plus the first stack frame that belongs to our
 * own code, with digits flattened so that two occurrences differing only by a
 * bundle hash or a line number group together.
 *
 * Deliberately computed here rather than in the database: the database stores it
 * as an opaque string, so improving the grouping is a deploy rather than a
 * migration.
 */
export function fingerprint(message: string, stack?: string | null): string {
  const normalisedMessage = scrubText(message)
    .toLowerCase()
    // Collapse anything that varies per occurrence but not per fault.
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const frame = firstOwnFrame(stack);
  return frame ? `${normalisedMessage}|${frame}` : normalisedMessage;
}

/**
 * The first stack frame worth grouping on.
 *
 * Frames inside `node_modules` and framework internals are skipped: a null
 * dereference in our code surfacing through React's reconciler should group by
 * our code, not by React, or every unrelated fault in the app collapses into one
 * enormous useless group.
 */
function firstOwnFrame(stack?: string | null): string {
  if (!stack) return "";
  for (const line of stack.split("\n").slice(1)) {
    if (/node_modules|react-dom|react-router|tanstack/i.test(line)) continue;
    const m = line.match(/(?:\/|\\)([\w.-]+\.(?:tsx?|jsx?|mjs))/);
    if (m) {
      // The filename, not the path: a chunk hash changes on every build, and a
      // fault that regroups on every deploy is a fault nobody can track.
      return m[1].replace(/-[A-Za-z0-9_]{6,}\.(?=[jt]sx?$)/, ".").toLowerCase();
    }
  }
  return "";
}

/** What a message is cut to before sending. The database truncates too. */
export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;

/** Turns an unknown thrown value into a message worth storing. */
export function messageOf(error: unknown): string {
  // Loaders and server functions commonly throw a raw Response. `String(it)` is
  // the opaque "[object Response]", which groups every HTTP failure in the app
  // into one meaningless bucket.
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${sanitizeRoute(new URL(error.url, "http://x").pathname)}` : ""}`;
  }
  if (error instanceof Error) return error.message || error.name || "Error";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error)?.slice(0, MAX_MESSAGE) || String(error);
  } catch {
    return String(error);
  }
}

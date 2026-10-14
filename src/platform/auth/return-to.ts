/**
 * Whose page a sign-in returns to.
 *
 * Signed out for inactivity, or with the session simply gone, the app sends
 * the browser to `/auth?next=<the page they were on>` so they come back to it.
 * Good manners for the same person; wrong for anybody else. Sada was signed out
 * on Alice's Organisation › Settings, signed in as Mark, and landed on
 * "Administrators only": Alice's page, handed to Mark.
 *
 * So the bounce writes down who it was for, in this browser only (never in the
 * URL), and the sign-in screen follows `next` only for that same person.
 * Somebody else lands on Home with a fresh start. A `next` that no bounce
 * wrote (an emailed deep link) is followed as before.
 */

const SHELL_USER_KEY = "neuvto.shellUser";
const RETURN_KEY = "neuvto.returnTo";

/** The app shell loaded for this person: they are whom a bounce would be for. */
export function rememberShellUser(userId: string): void {
  try {
    localStorage.setItem(SHELL_USER_KEY, userId);
  } catch {
    /* storage unavailable: a bounce then belongs to nobody, and is followed */
  }
}

/** The page is being left for `/auth`; `path` is what `next` will carry. */
export function leavingFor(path: string): void {
  try {
    const owner = localStorage.getItem(SHELL_USER_KEY);
    if (owner) localStorage.setItem(RETURN_KEY, JSON.stringify({ path, owner }));
    else localStorage.removeItem(RETURN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Where `userId` goes after signing in, given the `next` they arrived with.
 * The bounce's note is used once, then forgotten.
 */
export function returnFor(next: string, userId: string): string {
  let note: { path?: unknown; owner?: unknown } | null = null;
  try {
    note = JSON.parse(localStorage.getItem(RETURN_KEY) ?? "null");
    localStorage.removeItem(RETURN_KEY);
  } catch {
    note = null;
  }
  if (note && note.path === next && typeof note.owner === "string" && note.owner !== userId) {
    return "/app";
  }
  return next;
}

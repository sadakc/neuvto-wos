/**
 * Joining a workspace.
 *
 * There is exactly one way in, and this is it (D39). `createOrganization` used
 * to live here: any verified email could create a workspace and administer it,
 * which is how a second address of Sada's became an administrator of an
 * organisation nobody meant to exist. Workspaces are provisioned now, and the
 * person named as administrator arrives through the same door as everyone else.
 *
 * The link identifies the invitation; the six-digit code still proves the email.
 * A pure magic link would mean a forwarded message grants entry to an HR system,
 * and the code is one the invitee would be typing anyway to sign in.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError, type ErrorCode } from "@/platform/errors";

/**
 * Every reason an invitation can be refused, in words somebody can act on.
 *
 * INVITATION_NOT_FOUND deliberately covers expired, revoked, already-used,
 * addressed-to-someone-else and never-existed alike — the database returns one
 * message for all of them so a token cannot be probed, and inventing finer
 * distinctions here would undo that.
 */
/**
 * `match` is the string Postgres raises; `code` is ours. They are separate
 * fields because they genuinely differ — the database says NOT_AUTHENTICATED
 * and the published taxonomy says UNAUTHENTICATED — and conflating them meant
 * that refusal fell through to "something went wrong on our end", which is both
 * wrong and unactionable.
 */
const ACCEPT_ERRORS: { match: string; code: ErrorCode; message: string }[] = [
  {
    match: "INVITATION_NOT_FOUND",
    code: "INVITATION_NOT_FOUND",
    message:
      "This invitation link isn't valid. It may have expired, or already been used. Ask your administrator to send a new one.",
  },
  {
    match: "EMAIL_IN_ANOTHER_WORKSPACE",
    code: "EMAIL_IN_ANOTHER_WORKSPACE",
    message:
      "This email address is already in use in another Neuvto workspace. Ask your administrator to invite a different address.",
  },
  {
    match: "NOT_AUTHENTICATED",
    code: "UNAUTHENTICATED",
    message: "Please sign in again to accept this invitation.",
  },
];

export async function acceptInvitation(token: string): Promise<{ organizationId: string }> {
  const { data, error } = await supabase.rpc("invitation_accept", { _token: token });

  if (error) {
    const hit = ACCEPT_ERRORS.find((e) => error.message.includes(e.match));
    if (hit) throw new AppError(hit.code, hit.message, 400);
    throw toAppError(error, "acceptInvitation");
  }

  if (!data) {
    throw new AppError("INTERNAL_ERROR", "We couldn't complete your invitation.", 500);
  }
  return { organizationId: data as string };
}

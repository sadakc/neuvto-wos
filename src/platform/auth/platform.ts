/**
 * Platform ownership — Neuvto's own view, above every tenant.
 *
 * Sada provisions a customer workspace and names the person who will administer
 * it. That person is invited, not created: they accept like anybody else, which
 * means they have proved they control the address before they hold the role.
 *
 * D42 — a platform admin provisions and never reads tenant data. `listOrganizations`
 * is the entire read surface, and it returns names and counts. The enforcement
 * is not here: a platform admin has no profile, so `current_org_id()` is null
 * and every tenant policy already refuses them. The harness asserts that, and
 * sabotages it to prove the assertion can fail.
 */

import { supabase } from "@/integrations/supabase/client";
import { AppError, toAppError, type ErrorCode } from "@/platform/errors";
import { ProvisionInput } from "./contracts";

export interface CustomerWorkspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  adminEmail: string | null;
  adminAccepted: boolean;
  /** Present only while the administrator's invitation is unaccepted. */
  adminInviteUrl: string | null;
}

/**
 * Whether the signed-in person is Neuvto staff.
 *
 * Answered by the database, never inferred from anything the browser holds.
 * Used to decide whether to render the console at all — which is courtesy, not
 * security: every provisioning function re-checks it server-side.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
}

/**
 * A module, and where this customer stands with it.
 *
 * Two booleans because they answer different questions (D44): `granted` is
 * Neuvto's commercial decision, `enabled` is the customer's own switch. A
 * module is live only when both are true.
 */
export interface CustomerModule {
  key: string;
  name: string;
  status: "available" | "coming_soon" | "retired";
  granted: boolean;
  enabled: boolean;
}

export async function listOrganizationModules(organizationId: string): Promise<CustomerModule[]> {
  const { data, error } = await supabase.rpc("platform_list_org_modules", {
    _org_id: organizationId,
  });
  if (error) throw toAppError(error, "listOrganizationModules");

  return (data ?? []).map((r) => ({
    key: r.module_key,
    name: r.name,
    status: r.status as CustomerModule["status"],
    granted: r.granted,
    enabled: r.enabled,
  }));
}

/** Grants or withdraws a module for a customer. Withdrawal is soft — their data stays. */
export async function setOrganizationModule(
  organizationId: string,
  moduleKey: string,
  granted: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("platform_set_module", {
    _org_id: organizationId,
    _module_key: moduleKey,
    _granted: granted,
  });
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      throw new AppError("FORBIDDEN", "Only Neuvto staff can change a customer's modules.", 403);
    }
    throw toAppError(error, "setOrganizationModule");
  }
}

export async function listOrganizations(): Promise<CustomerWorkspace[]> {
  const { data, error } = await supabase.rpc("platform_list_organizations");
  if (error) throw toAppError(error, "listOrganizations");

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    adminEmail: r.admin_email,
    adminAccepted: r.admin_accepted,
    adminInviteUrl: r.admin_invite_url,
  }));
}

const PROVISION_ERRORS: Partial<Record<ErrorCode, { message: string; field?: string }>> = {
  SLUG_TAKEN: { message: "That workspace address is already taken.", field: "slug" },
  INVALID_EMAIL: { message: "Enter a valid administrator email address.", field: "adminEmail" },
  ORGANIZATION_NAME_REQUIRED: { message: "Enter the company name.", field: "organizationName" },
};

export async function provisionOrganization(input: unknown): Promise<{ organizationId: string }> {
  const parsed = ProvisionInput.parse(input);

  const { data, error } = await supabase.rpc("provision_organization", {
    _name: parsed.organizationName,
    _slug: parsed.slug,
    _admin_email: parsed.adminEmail,
    _admin_phone: parsed.adminPhone || undefined,
    _admin_name: parsed.adminName || undefined,
  });

  if (error) {
    const code = (Object.keys(PROVISION_ERRORS) as ErrorCode[]).find((k) =>
      error.message.includes(k),
    );
    if (code) {
      const e = PROVISION_ERRORS[code]!;
      throw new AppError(code, e.message, 400, e.field ? { field: e.field } : undefined);
    }
    // 42501. Shown rather than hidden: somebody who reached this screen and is
    // not staff should be told plainly, not left with a form that silently
    // never works.
    if (error.message.includes("FORBIDDEN")) {
      throw new AppError("FORBIDDEN", "Only Neuvto staff can provision a workspace.", 403);
    }
    // The slug format CHECK, reached when the client rule and the database rule
    // have drifted apart.
    if (error.message.includes("organizations_slug_format")) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Use lowercase letters, numbers and hyphens only.",
        400,
        {
          field: "slug",
        },
      );
    }
    throw toAppError(error, "provisionOrganization");
  }

  if (!data) throw new AppError("INTERNAL_ERROR", "The workspace could not be created.", 500);
  return { organizationId: data as string };
}

/** Whether mail is actually being delivered, and why not. Platform admins only. */
export interface MailHealth {
  healthy: boolean;
  failed24h: number;
  pendingNow: number;
  oldestPendingMinutes: number;
  lastSentAt: string | null;
  lastFailureAt: string | null;
  /** Addresses are stripped in the database before this leaves it (D42). */
  lastFailureReason: string | null;
}

/**
 * Reads the mail alarm.
 *
 * Exists because three invitations failed on production for twelve hours and
 * nothing said so — every check was green while nothing could be delivered.
 *
 * Failures here are swallowed deliberately and reported as "unknown" by the
 * caller rather than thrown. A health check that takes down the console when it
 * cannot answer has made the outage worse, and this is the one screen somebody
 * opens *because* something seems wrong.
 */
export async function getMailHealth(): Promise<MailHealth | null> {
  const { data, error } = await supabase.rpc("platform_mail_health");
  if (error) return null;

  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;

  return {
    healthy: Boolean(r.healthy),
    failed24h: Number(r.failed_24h ?? 0),
    pendingNow: Number(r.pending_now ?? 0),
    oldestPendingMinutes: Number(r.oldest_pending_minutes ?? 0),
    lastSentAt: r.last_sent_at ?? null,
    lastFailureAt: r.last_failure_at ?? null,
    lastFailureReason: r.last_failure_reason ?? null,
  };
}

// ─────────────────────────────────────────────────────── front-end errors

export interface ClientErrorGroup {
  fingerprint: string;
  message: string;
  route: string | null;
  mechanism: string;
  severity: string;
  /** Total across every day in the window, not rows. */
  occurrences: number;
  /** How many separate days this fault has appeared on. */
  daysSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  release: string | null;
  stack: string | null;
}

/**
 * Reads the front-end error store.
 *
 * Exists because until 4 Aug 2026 a crash in production went nowhere at all:
 * `reportLovableError` forwards to hooks that live only inside the Lovable
 * editor, so the root boundary rendered "This page didn't load" and told no one.
 *
 * Swallows its own failure and returns null, for the same reason `getMailHealth`
 * does — this is the screen somebody opens *because* something seems wrong, and
 * a monitor that takes the console down when it cannot answer has made the
 * outage worse. The caller renders "unknown" rather than "all clear".
 *
 * Note there is no organisation in this shape, deliberately. Which customer hit
 * a bug is tenant data (D42) and the fault is diagnosable without it.
 */
export async function getClientErrors(days = 7): Promise<ClientErrorGroup[] | null> {
  const { data, error } = await supabase.rpc("platform_client_errors", { p_days: days });
  if (error) return null;
  if (!Array.isArray(data)) return [];

  return data.map((r) => ({
    fingerprint: String(r.fingerprint),
    message: String(r.message ?? ""),
    route: r.route ?? null,
    mechanism: String(r.mechanism ?? "unknown"),
    severity: String(r.severity ?? "error"),
    occurrences: Number(r.occurrences ?? 0),
    daysSeen: Number(r.days_seen ?? 0),
    firstSeenAt: String(r.first_seen_at),
    lastSeenAt: String(r.last_seen_at),
    release: r.release ?? null,
    stack: r.stack ?? null,
  }));
}

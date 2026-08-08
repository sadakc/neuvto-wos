/**
 * Platform · Authentication
 *
 * The only import path for auth. Nothing outside this directory reaches into
 * its internals, and nothing anywhere imports a vendor auth SDK directly —
 * that quarantine is what keeps the project portable (CODING_STANDARDS §9).
 */

export { requestOtp, verifyOtp, signOut } from "./otp";
export {
  getUserId,
  getCurrentUser,
  getSessionEmail,
  getSessionStartedAt,
  hasRole,
  isAdmin,
  canApprove,
} from "./session";

/**
 * D39 — the one way into a workspace. `createOrganization` is deliberately
 * absent: self-serve signup let any verified address create a workspace and
 * administer it, and workspaces are provisioned now.
 */
export { acceptInvitation } from "./invitations";
export {
  isPlatformAdmin,
  listOrganizations,
  getMailHealth,
  getClientErrors,
  listOrganizationModules,
  setOrganizationModule,
  provisionOrganization,
  markTestOrganization,
  unmarkTestOrganization,
  type CustomerWorkspace,
  type MailHealth,
  type ClientErrorGroup,
  type CustomerModule,
} from "./platform";
export {
  inviteMember,
  revokeInvitation,
  listInvitations,
  listMembers,
  listDirectReports,
  setReportingLine,
  setJoinedDate,
  accountStatus,
  reactivateMember,
  deactivationImpact,
  deactivateMember,
  type Member,
  type Invitation,
  type DeactivationImpact,
} from "./members";

export {
  APP_ROLES,
  ROLE_LABELS,
  EmailInput,
  VerifyOtpInput,
  SignupInput,
  ProvisionInput,
  InviteInput,
  PhoneInput,
  suggestSlug,
  type AppRole,
  type CurrentUser,
} from "./contracts";

export { installIdleWatcher } from "./idle";
export { getSessionPolicy, type SessionPolicy } from "./session-policy";
export { decide as decideIdle, type IdleVerdict } from "./idle-policy";

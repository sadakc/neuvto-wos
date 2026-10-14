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
  isSuperAdmin,
  isModuleAdmin,
  administersAnyModule,
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
  listSuperAdmins,
  addSuperAdmin,
  removeSuperAdmin,
  withdrawSuperAdminInvite,
  type CompanySuperAdmin,
  type CustomerWorkspace,
  type MailHealth,
  type ClientErrorGroup,
  type CustomerModule,
} from "./platform";
export {
  revokeInvitation,
  listInvitations,
  listMembers,
  listDirectReports,
  setReportingLine,
  setMemberRoles,
  setMemberModuleAdmins,
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
  ROLE_DESCRIPTIONS,
  APPROVER_ROLES,
  SUPER_ADMIN_GRANTS,
  EmailInput,
  VerifyOtpInput,
  SignupInput,
  ProvisionInput,
  PhoneInput,
  suggestSlug,
  type AppRole,
  type CurrentUser,
} from "./contracts";

export { installIdleWatcher } from "./idle";
export { getSessionPolicy, type SessionPolicy } from "./session-policy";
export { decide as decideIdle, type IdleVerdict } from "./idle-policy";

// The CSV reader, shared so a module importing its own records reads a file
// exactly as the People import does: quotes, commas and line endings alike.

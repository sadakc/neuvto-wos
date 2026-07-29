/**
 * Platform · Authentication
 *
 * The only import path for auth. Nothing outside this directory reaches into
 * its internals, and nothing anywhere imports a vendor auth SDK directly —
 * that quarantine is what keeps the project portable (CODING_STANDARDS §9).
 */

export { requestOtp, verifyOtp, signOut } from "./otp";
export { getUserId, getCurrentUser, hasRole, isAdmin, canApprove } from "./session";
export { createOrganization } from "./signup";
export {
  APP_ROLES,
  EmailInput,
  VerifyOtpInput,
  SignupInput,
  suggestSlug,
  type AppRole,
  type CurrentUser,
} from "./contracts";

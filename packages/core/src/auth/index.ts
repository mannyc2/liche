export { secret, isSecretString } from './secret.js'
export type { SecretString } from './secret.js'
export {
  AUTH_CODES,
  authMissing,
  authCiTokenMissing,
  authContextRequired,
  authScopeMissing,
  authPermissionDenied,
  authInvalid,
  authExpired,
  authInteractiveRequired,
  authSessionCorrupt,
  authSessionLocked,
} from './errors.js'
export type { AuthErrorCode, AuthErrorDetails } from './errors.js'
export { resolveAuth, resolveContext, applyAuth } from './resolve.js'
export type { ResolveAuthInput, ResolveContextInput } from './resolve.js'
export { authSwitch, authWhoami, logoutAuthSession, oauthDeviceLogin } from './device.js'
export type { AuthRuntimeInput } from './device.js'
export { createFileSessionStore } from './session-store.js'
export type { FileSessionStoreOptions } from './session-store.js'
export type {
  AuthCommandRuntime,
  AuthCredential,
  AuthGlobalOptions,
  AuthIdentityProbeInput,
  AuthProviderRuntime,
  ContextRuntime,
  EnvTokenSourceSpec,
  IdentityRuntime,
  InvocationKind,
  OAuthDeviceRuntime,
  SessionStore,
  SessionTokenSourceSpec,
  StoredProfile,
  TokenSourceSpec,
} from './types.js'

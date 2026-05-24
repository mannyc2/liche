export { secret, isSecretString } from './secret.js'
export type { SecretString } from './secret.js'
export {
  AUTH_CODES,
  authInvalid,
  authPermissionDenied,
} from './errors.js'
export type { AuthErrorCode, AuthErrorDetails } from './errors.js'
export { applyAuth } from './resolve.js'
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

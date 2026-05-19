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
} from './errors.js'
export type { AuthErrorCode, AuthErrorDetails } from './errors.js'
export { resolveAuth, resolveContext, applyAuth, authMetaFromCredential } from './resolve.js'
export type { ResolveAuthInput, ResolveContextInput } from './resolve.js'
export type {
  AuthCredential,
  AuthProviderRuntime,
  ContextRuntime,
  InvocationKind,
  ResolvedAuthMeta,
  TokenSourceSpec,
} from './types.js'

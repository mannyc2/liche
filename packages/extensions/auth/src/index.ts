export { auth, authGlobals } from './extension.js'
export { createFileSessionStore } from './session-store.js'
export { resolveAuth } from './resolve.js'
export { resolveContext } from './context.js'
export { authSwitch, authWhoami, logoutAuthSession } from './session.js'
export { oauthDeviceLogin } from './device.js'
export { detectInvocation } from './invocation.js'
export { applyAuth, credentialHttpAuth } from './http.js'
export type {
  AuthCommandRuntime,
  AuthCredential,
  AuthIdentityProbeInput,
  AuthProviderRuntime,
  ContextRuntime,
  EnvTokenSourceSpec,
  AuthRuntimeInput,
  FileSessionStoreOptions,
  IdentityRuntime,
  InvocationKind,
  OAuthDeviceRuntime,
  ResolveAuthInput,
  ResolveContextInput,
  SessionStore,
  SessionTokenSourceSpec,
  StoredProfile,
  TokenSourceSpec,
} from './types.js'

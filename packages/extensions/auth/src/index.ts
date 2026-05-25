export { auth, authGlobals } from './extension.js'
export { createFileSessionStore } from './session-store.js'
export { resolveAuth } from './resolve.js'
export { resolveContext } from './context.js'
export { authSwitch, authWhoami, logoutAuthSession } from './session.js'
export { oauthDeviceLogin } from './device.js'
export type {
  AuthRuntimeInput,
  FileSessionStoreOptions,
  ResolveAuthInput,
  ResolveContextInput,
  SessionStore,
  StoredProfile,
} from './types.js'

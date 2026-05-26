import type {
  AuthCredential,
  AuthIdentityProbeInput,
  AuthProviderRuntime,
  ContextRuntime,
} from '@liche/core'

export type InvocationKind = 'cli' | 'ci' | 'agent' | 'mcp'

export type StoredProfile = {
  schemaVersion: 1
  productId: string
  providerId: string
  profile: string
  createdAt: string
  updatedAt: string
  account?: { id: string; label?: string | undefined } | undefined
  selectedContexts?: Record<string, string> | undefined
  credential?: {
    kind: 'bearer' | 'apiKey'
    accessToken?: AuthCredential['secret'] | undefined
    expiresAt?: string | undefined
    scopes?: string[] | undefined
  } | undefined
}

export interface SessionStore {
  listProfiles(productId: string, providerId: string): Promise<string[]>
  loadProfile(productId: string, providerId: string, profile: string): Promise<StoredProfile | undefined>
  saveProfile(productId: string, providerId: string, profile: string, value: StoredProfile): Promise<void>
  deleteProfile(productId: string, providerId: string, profile: string): Promise<void>
  deleteAllProfiles(productId: string, providerId: string): Promise<number>
  getActiveProfile(productId: string, providerId: string): Promise<string | undefined>
  setActiveProfile(productId: string, providerId: string, profile: string): Promise<void>
}

export type FileSessionStoreOptions = {
  lockTimeoutMs?: number | undefined
  now?: (() => Date) | undefined
  root?: string | undefined
}

export type ResolveAuthInput = {
  provider: AuthProviderRuntime
  required: boolean
  requiredScopes?: string[] | undefined
  requiredPermissions?: string[] | undefined
  productId?: string | undefined
  profile?: string | undefined
  profileEnvVar?: string | undefined
  invocation: InvocationKind
  nonInteractive?: boolean | undefined
  allowStoredSession?: boolean | undefined
  noSession?: boolean | undefined
  env?: Record<string, string | undefined> | undefined
  loginCommand?: string | undefined
  sessionStore?: SessionStore | undefined
}

export type ResolveContextInput = {
  contexts: ContextRuntime[]
  required: string[]
  explicit?: Record<string, string | undefined> | undefined
  env?: Record<string, string | undefined> | undefined
  credentialSource?: 'env' | 'session' | 'none' | undefined
  providerId?: string | undefined
  profile?: StoredProfile | undefined
  profileExplicit?: boolean | undefined
}

export type AuthRuntimeInput = {
  allowStoredSession?: boolean | undefined
  baseUrl?: AuthIdentityProbeInput['baseUrl'] | undefined
  env?: Record<string, string | undefined> | undefined
  fetch?: AuthIdentityProbeInput['fetch'] | undefined
  global?: { nonInteractive?: boolean | undefined; noSession?: boolean | undefined; profile?: string | undefined } | undefined
  invocation: InvocationKind
  loginCommand?: string | undefined
  productId: string
  profile?: string | undefined
  profileEnvVar?: string | undefined
  provider: AuthProviderRuntime
  sessionStore: SessionStore
}

export type AuthStatus = {
  authenticated: boolean
  source?: 'env' | 'session' | undefined
  profile?: string | undefined
  account?: { id: string; label?: string | undefined } | undefined
  contexts?: Record<string, string> | undefined
  expiresAt?: string | undefined
  refreshAvailable?: boolean | undefined
}

import type { HttpFetch, HttpMethod, RuntimeValue } from '../http/index.js'
import type { SecretString } from './secret.js'

export type InvocationKind = 'cli' | 'ci' | 'agent' | 'mcp'

export type EnvTokenSourceSpec = {
  kind: 'env'
  envVar: string
  mode?: 'any' | 'ci' | undefined
  label?: string | undefined
  scopes?: string[] | undefined
}

export type SessionTokenSourceSpec = {
  kind: 'session'
  refresh?: boolean | undefined
  profiles?: boolean | undefined
}

export type TokenSourceSpec = EnvTokenSourceSpec | SessionTokenSourceSpec

export type OAuthDeviceRuntime = {
  clientId: string
  endpoints: {
    deviceAuthorization: string
    token: string
    revoke?: string | undefined
  }
  scopes?: string[] | undefined
}

export type IdentityRuntime = {
  http: {
    method: HttpMethod
    path: string
  }
  subject: string
  label?: string | undefined
}

export type AuthCommandRuntime = {
  login?: string | undefined
  logout?: string | undefined
  switch?: string | undefined
  whoami?: string | undefined
}

export type AuthProviderRuntime = {
  id: string
  kind: 'none' | 'bearer' | 'apiKey' | 'oauthDevice'
  header?: string | undefined
  tokenKind?: 'bearer' | 'apiKey' | undefined
  tokenSources: TokenSourceSpec[]
  commands?: AuthCommandRuntime | undefined
  identity?: IdentityRuntime | undefined
  oauthDevice?: OAuthDeviceRuntime | undefined
  session?: { enabled: boolean; profiles: boolean } | undefined
}

export type AuthCredential = {
  providerId: string
  source: 'env' | 'session'
  profile?: string | undefined
  kind: 'bearer' | 'apiKey'
  secret: SecretString
  header?: string | undefined
  account?: { id: string; label?: string | undefined } | undefined
  scopes?: string[] | undefined
  expiresAt?: string | undefined
  refreshAvailable: boolean
}

export type ContextRuntime = {
  id: string
  label?: string | undefined
  flag?: string | undefined
  envVar?: string | undefined
}

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
    accessToken?: SecretString | undefined
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

export type AuthGlobalOptions = {
  nonInteractive?: boolean | undefined
  noSession?: boolean | undefined
  profile?: string | undefined
}

export type AuthIdentityProbeInput = {
  baseUrl: RuntimeValue | string
  credential: AuthCredential
  env?: Record<string, string | undefined> | undefined
  fetch?: HttpFetch | undefined
  identity: IdentityRuntime
}

export type ResolvedAuthMeta =
  | { kind: 'none' }
  | {
      kind: 'resolved'
      providerId: string
      source: 'env' | 'session'
      profile?: string | undefined
      account?: { id: string; label?: string | undefined } | undefined
      scopes?: string[] | undefined
      expiresAt?: string | undefined
    }

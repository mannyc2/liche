import type { SecretString } from './secret.js'

export type InvocationKind = 'cli' | 'ci' | 'agent' | 'mcp'

export type TokenSourceSpec = {
  kind: 'env'
  envVar: string
  mode?: 'any' | 'ci' | undefined
  label?: string | undefined
  scopes?: string[] | undefined
}

export type AuthProviderRuntime = {
  id: string
  kind: 'none' | 'bearer' | 'apiKey' | 'oauthDevice'
  header?: string | undefined
  tokenSources: TokenSourceSpec[]
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

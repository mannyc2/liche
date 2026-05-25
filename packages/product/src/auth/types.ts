import type { HttpSpec } from '../command/types.js'

export type TokenSourceMode = 'any' | 'ci'

export type EnvTokenSource = {
  kind: 'env'
  envVar: string
  mode?: TokenSourceMode
  label?: string
  scopes?: readonly string[]
}

export type SessionTokenSource = {
  kind: 'session'
  profiles?: boolean
  refresh?: boolean
}

export type TokenSource = EnvTokenSource | SessionTokenSource

export type AuthNoneSpec = { kind: 'none' }

export type AuthApiKeySpec = {
  kind: 'apiKey'
  id: string
  header: string
  sources: TokenSource[]
}

export type AuthBearerSpec = {
  kind: 'bearer'
  id: string
  header?: string
  sources: TokenSource[]
}

export type AuthIdentitySpec = {
  http: HttpSpec
  subject: string
  label?: string
}

export type AuthCommandSpec = {
  login?: string
  logout?: string
  switch?: string
  whoami?: string
}

export type AuthOAuthDeviceSpec = {
  kind: 'oauthDevice'
  id: string
  token: { kind: 'bearer' | 'apiKey'; header?: string }
  clientId: string
  endpoints: {
    deviceAuthorization: string
    token: string
    revoke?: string
  }
  sources: TokenSource[]
  identity?: AuthIdentitySpec
  commands?: AuthCommandSpec
  scopes?: readonly string[]
}

export type AuthSpec = AuthNoneSpec | AuthApiKeySpec | AuthBearerSpec | AuthOAuthDeviceSpec

export type ContextSelectSpec = {
  flag?: string
  env?: string
}

export type ContextEnvSpec = {
  kind: 'env'
  label?: string
  select: ContextSelectSpec
}

export type ContextRemoteSpec = {
  kind: 'remote'
  label?: string
  idField?: string
  nameField?: string
  list?: { http: HttpSpec }
  select: ContextSelectSpec
}

export type ContextSpec = ContextEnvSpec | ContextRemoteSpec

export type ProductContextEntry = {
  id: string
  spec: ContextSpec
}

export type PermissionScopeSpec = {
  kind: 'scope'
  scope: string
  description?: string
}

export type PermissionSpec = PermissionScopeSpec

export type RequiresSpec = {
  auth?: boolean
  contexts?: readonly string[]
  permissions?: readonly string[]
}

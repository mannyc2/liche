import type {
  AuthApiKeySpec,
  AuthBearerSpec,
  AuthCommandSpec,
  AuthIdentitySpec,
  AuthNoneSpec,
  AuthOAuthDeviceSpec,
  ContextEnvSpec,
  ContextRemoteSpec,
  ContextSelectSpec,
  EnvTokenSource,
  PermissionScopeSpec,
  SessionTokenSource,
  TokenSource,
  TokenSourceMode,
} from './types.js'
import type { HttpSpec } from '../command/types.js'

export const Auth = {
  none(): AuthNoneSpec {
    return { kind: 'none' }
  },
  apiKey(init: { id: string; header: string; sources: TokenSource[] }): AuthApiKeySpec {
    return { kind: 'apiKey', id: init.id, header: init.header, sources: [...init.sources] }
  },
  bearer(init: { id: string; header?: string; sources: TokenSource[] }): AuthBearerSpec {
    const out: AuthBearerSpec = { kind: 'bearer', id: init.id, sources: [...init.sources] }
    if (init.header) out.header = init.header
    return out
  },
  oauthDevice(init: {
    id: string
    token: { kind: 'bearer' | 'apiKey'; header?: string }
    clientId: string
    endpoints: AuthOAuthDeviceSpec['endpoints']
    sources: TokenSource[]
    identity?: AuthIdentitySpec
    commands?: AuthCommandSpec
    scopes?: readonly string[]
  }): AuthOAuthDeviceSpec {
    const out: AuthOAuthDeviceSpec = {
      kind: 'oauthDevice',
      id: init.id,
      token: { ...init.token },
      clientId: init.clientId,
      endpoints: { ...init.endpoints },
      sources: [...init.sources],
    }
    if (init.identity) out.identity = init.identity
    if (init.commands) out.commands = { ...init.commands }
    if (init.scopes) out.scopes = [...init.scopes]
    return out
  },
  commands(init: AuthCommandSpec): AuthCommandSpec {
    return { ...init }
  },
  identity(init: AuthIdentitySpec): AuthIdentitySpec {
    return { ...init, http: { ...init.http } }
  },
  token: {
    env(envVar: string, opts?: { mode?: TokenSourceMode; label?: string; scopes?: readonly string[] }): EnvTokenSource {
      const out: EnvTokenSource = { kind: 'env', envVar }
      if (opts?.mode) out.mode = opts.mode
      if (opts?.label) out.label = opts.label
      if (opts?.scopes) out.scopes = [...opts.scopes]
      return out
    },
    session(opts?: { profiles?: boolean; refresh?: boolean }): SessionTokenSource {
      const out: SessionTokenSource = { kind: 'session' }
      if (opts?.profiles !== undefined) out.profiles = opts.profiles
      if (opts?.refresh !== undefined) out.refresh = opts.refresh
      return out
    },
  },
  permission: {
    scope(scope: string, opts?: { description?: string }): PermissionScopeSpec {
      const out: PermissionScopeSpec = { kind: 'scope', scope }
      if (opts?.description) out.description = opts.description
      return out
    },
  },
  context: {
    env(init: { label?: string; select: ContextSelectSpec }): ContextEnvSpec {
      const out: ContextEnvSpec = { kind: 'env', select: { ...init.select } }
      if (init.label) out.label = init.label
      return out
    },
    remote(init: {
      label?: string
      idField?: string
      nameField?: string
      list?: { http: HttpSpec }
      select: ContextSelectSpec
    }): ContextRemoteSpec {
      const out: ContextRemoteSpec = { kind: 'remote', select: { ...init.select } }
      if (init.label) out.label = init.label
      if (init.idField) out.idField = init.idField
      if (init.nameField) out.nameField = init.nameField
      if (init.list) out.list = init.list
      return out
    },
  },
} as const

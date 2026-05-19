import type { HttpSpec } from './command.js'

export type TokenSourceMode = 'any' | 'ci'

export type EnvTokenSource = {
  kind: 'env'
  envVar: string
  mode?: TokenSourceMode
  label?: string
}

export type TokenSource = EnvTokenSource

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

export type AuthSpec = AuthNoneSpec | AuthApiKeySpec | AuthBearerSpec

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
  token: {
    env(envVar: string, opts?: { mode?: TokenSourceMode; label?: string }): EnvTokenSource {
      const out: EnvTokenSource = { kind: 'env', envVar }
      if (opts?.mode) out.mode = opts.mode
      if (opts?.label) out.label = opts.label
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

export type RequiresSpec = {
  auth?: boolean
  contexts?: readonly string[]
  permissions?: readonly string[]
}

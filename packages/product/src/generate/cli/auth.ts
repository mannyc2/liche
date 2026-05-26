import type {
  Capability,
  Catalog,
  CommandCapability,
  NormalizedAuth,
  NormalizedContext,
  NormalizedPermission,
} from '../../catalog/types.js'
import {
  neededContexts,
  needsAuthResolution,
} from './predicates.js'
import { q, renderRuntimeValue, renderStringArray } from './render.js'

export function renderAuth(auth: Exclude<NormalizedAuth, { kind: 'none' }>): string {
  const sources = auth.tokenSources
    .map((s) => {
      if (s.kind === 'session') {
        return `{ kind: 'session', profiles: ${s.profiles ? 'true' : 'false'}, refresh: ${s.refresh ? 'true' : 'false'} }`
      }
      const fields = [`kind: 'env'`, `envVar: ${q(s.envVar)}`, `mode: ${q(s.mode)}`]
      if (s.label) fields.push(`label: ${q(s.label)}`)
      if (s.scopes) fields.push(`scopes: ${renderStringArray(s.scopes)}`)
      return `{ ${fields.join(', ')} }`
    })
    .join(', ')
  const parts = [`id: ${q(auth.id)}`, `kind: ${q(auth.kind)}`]
  if (auth.header) parts.push(`header: ${q(auth.header)}`)
  if (auth.tokenKind) parts.push(`tokenKind: ${q(auth.tokenKind)}`)
  parts.push(`tokenSources: [${sources}]`)
  if (auth.session) parts.push(`session: { enabled: true, profiles: ${auth.session.profiles ? 'true' : 'false'} }`)
  if (auth.commands) parts.push(`commands: ${renderAuthCommands(auth.commands)}`)
  if (auth.oauthDevice) parts.push(`oauthDevice: ${renderOauthDevice(auth.oauthDevice)}`)
  if (auth.identity) parts.push(`identity: ${renderIdentity(auth.identity)}`)
  return `{ ${parts.join(', ')} }`
}

function renderAuthCommands(commands: Exclude<NormalizedAuth, { kind: 'none' }>['commands']): string {
  const entries = Object.entries(commands ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${q(value as string)}`)
  return `{ ${entries.join(', ')} }`
}

function renderOauthDevice(oauth: NonNullable<Exclude<NormalizedAuth, { kind: 'none' }>['oauthDevice']>): string {
  const endpoints = [
    `deviceAuthorization: ${q(oauth.endpoints.deviceAuthorization)}`,
    `token: ${q(oauth.endpoints.token)}`,
  ]
  if (oauth.endpoints.revoke) endpoints.push(`revoke: ${q(oauth.endpoints.revoke)}`)
  const parts = [`clientId: ${q(oauth.clientId)}`, `endpoints: { ${endpoints.join(', ')} }`]
  if (oauth.scopes) parts.push(`scopes: ${renderStringArray(oauth.scopes)}`)
  return `{ ${parts.join(', ')} }`
}

function renderIdentity(identity: NonNullable<Exclude<NormalizedAuth, { kind: 'none' }>['identity']>): string {
  const parts = [
    `http: { method: ${q(identity.http.method)}, path: ${q(identity.http.path)} }`,
    `subject: ${q(identity.subject)}`,
  ]
  if (identity.label) parts.push(`label: ${q(identity.label)}`)
  return `{ ${parts.join(', ')} }`
}

export function renderContexts(contexts: NormalizedContext[]): string {
  const entries = contexts.map((c) => {
    const parts = [`id: ${q(c.id)}`]
    if (c.label) parts.push(`label: ${q(c.label)}`)
    if (c.select.flag) parts.push(`flag: ${q(c.select.flag)}`)
    if (c.select.env) parts.push(`envVar: ${q(c.select.env)}`)
    return `{ ${parts.join(', ')} }`
  })
  return `[${entries.join(', ')}]`
}

export function renderAuthRuntimeArgs(indent: string, catalog: Catalog): string[] {
  const lines = [
    `${indent}productId: PRODUCT_ID,`,
    `${indent}provider: AUTH_PROVIDER,`,
    `${indent}profileEnvVar: PROFILE_ENV_VAR,`,
    `${indent}global: ctx.global,`,
    `${indent}invocation: detectInvocation(ctx),`,
    `${indent}env: ctx.env as Record<string, string | undefined>,`,
    `${indent}loginCommand: ${q(`${catalog.product.id} login`)},`,
  ]
  if (catalog.remote) lines.push(`${indent}baseUrl: ${renderRuntimeValue(catalog.remote.baseUrl)},`)
  return lines
}

export function renderSwitchOptions(contexts: NormalizedContext[], indent: string): string {
  const entries = [`${indent}  profile: z.string().optional(),`]
  for (const ctx of contexts) {
    if (!ctx.select.flag) continue
    entries.push(`${indent}  ${q(ctx.select.flag)}: z.string().optional(),`)
  }
  return `z.object({\n${entries.join('\n')}\n${indent}})`
}

export function renderAuthOutputSchema(id: string): string {
  const account = `z.object({ id: z.string(), label: z.string().optional() })`
  const contexts = `z.record(z.string(), z.string())`
  if (id === 'auth.switch') {
    return `z.object({ profile: z.string(), contexts: ${contexts} })`
  }
  if (id === 'auth.logout') {
    return `z.object({ authenticated: z.boolean(), deleted: z.number(), profile: z.string().optional() })`
  }
  const fields = [
    `authenticated: z.boolean()`,
    `source: z.enum(['env', 'session']).optional()`,
    `profile: z.string().optional()`,
    `account: ${account}.optional()`,
    `contexts: ${contexts}.optional()`,
    `expiresAt: z.string().optional()`,
    `refreshAvailable: z.boolean().optional()`,
  ]
  if (id === 'auth.login') {
    fields.push(`verificationUri: z.string().optional()`)
    fields.push(`userCode: z.string().optional()`)
  }
  return `z.object({ ${fields.join(', ')} })`
}

export function requiredScopesFor(permissions: NormalizedPermission[], cap: Capability): string[] {
  const byId = new Map(permissions.map((permission) => [permission.id, permission]))
  return cap.requires.permissions.flatMap((id) => {
    const scope = byId.get(id)?.scope
    return scope ? [scope] : []
  })
}

export function renderAuthPreamble(indent: string, catalog: Catalog, cap: Capability, hasHttpTransport: boolean): string[] {
  const lines: string[] = []
  if (needsAuthResolution(cap)) {
    lines.push(`${indent}const sessionStore = createFileSessionStore()`)
    lines.push(`${indent}const credential = await resolveAuth({`)
    lines.push(`${indent}  provider: AUTH_PROVIDER,`)
    lines.push(`${indent}  productId: PRODUCT_ID,`)
    lines.push(`${indent}  required: true,`)
    if (cap.requires.permissions.length > 0) {
      lines.push(`${indent}  requiredPermissions: ${renderStringArray(cap.requires.permissions)},`)
    }
    const requiredScopes = requiredScopesFor(catalog.permissions, cap)
    if (requiredScopes.length > 0) {
      lines.push(`${indent}  requiredScopes: ${renderStringArray(requiredScopes)},`)
    }
    lines.push(`${indent}  invocation: detectInvocation(ctx),`)
    lines.push(`${indent}  profile: ctx.global.profile,`)
    lines.push(`${indent}  profileEnvVar: PROFILE_ENV_VAR,`)
    lines.push(`${indent}  nonInteractive: ctx.global.nonInteractive,`)
    lines.push(`${indent}  noSession: ctx.global.noSession,`)
    lines.push(`${indent}  env: ctx.env as Record<string, string | undefined>,`)
    lines.push(`${indent}  loginCommand: ${q(`${catalog.product.id} login`)},`)
    lines.push(`${indent}  sessionStore,`)
    lines.push(`${indent}})`)
  }
  if (neededContexts(cap).length > 0) {
    if (needsAuthResolution(cap)) {
      lines.push(`${indent}const storedProfile = !ctx.global.noSession && (credential?.source === 'session' || ctx.global.profile)`)
      lines.push(`${indent}  ? await sessionStore.loadProfile(PRODUCT_ID, AUTH_PROVIDER.id, credential?.profile ?? ctx.global.profile ?? 'default')`)
      lines.push(`${indent}  : undefined`)
    }
    const required = neededContexts(cap).map((c) => q(c)).join(', ')
    lines.push(`${indent}const context = await resolveContext({`)
    lines.push(`${indent}  contexts: CONTEXTS,`)
    lines.push(`${indent}  required: [${required}],`)
    lines.push(`${indent}  explicit: ctx.options as Record<string, string | undefined>,`)
    lines.push(`${indent}  env: ctx.env as Record<string, string | undefined>,`)
    if (needsAuthResolution(cap)) {
      lines.push(`${indent}  providerId: AUTH_PROVIDER.id,`)
      lines.push(`${indent}  credentialSource: credential?.source ?? 'none',`)
      lines.push(`${indent}  profile: storedProfile,`)
      lines.push(`${indent}  profileExplicit: ctx.global.profile !== undefined,`)
    }
    lines.push(`${indent}})`)
  }
  // Mark intentionally-unused auth/context locals for non-HTTP commands.
  if (!hasHttpTransport && needsAuthResolution(cap)) lines.push(`${indent}void credential`)
  if (!hasHttpTransport && neededContexts(cap).length > 0) lines.push(`${indent}void context`)
  return lines
}

export function renderAuthCapability(indent: string, catalog: Catalog, cap: CommandCapability): string[] {
  const lines: string[] = []
  lines.push(`${indent}defineCommand({`)
  lines.push(`${indent}  path: ${renderStringArray(cap.command)},`)
  if (cap.id === 'auth.login') lines.push(`${indent}  interactive: true,`)
  lines.push(`${indent}  summary: ${q(cap.summary)},`)
  lines.push(`${indent}  input: {`)
  if (cap.id === 'auth.switch') {
    lines.push(`${indent}    options: ${renderSwitchOptions(catalog.contexts, `${indent}    `)},`)
  } else if (cap.id === 'auth.logout') {
    lines.push(`${indent}    options: z.object({ profile: z.string().optional(), all: z.boolean().optional() }),`)
  } else {
    lines.push(`${indent}    options: z.object({ profile: z.string().optional() }),`)
  }
  lines.push(`${indent}  },`)
  lines.push(`${indent}  output: ${renderAuthOutputSchema(cap.id)},`)
  lines.push(`${indent}  async run({ ctx }) {`)
  lines.push(`${indent}    const sessionStore = createFileSessionStore()`)
  lines.push(`${indent}    const profile = typeof ctx.options.profile === 'string' ? ctx.options.profile : undefined`)
  if (cap.id === 'auth.whoami') {
    lines.push(`${indent}    const data = await authWhoami({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}    })`)
  } else if (cap.id === 'auth.switch') {
    lines.push(`${indent}    const data = await authSwitch({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      contexts: CONTEXTS,`)
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}      values: ctx.options as Record<string, string | undefined>,`)
    lines.push(`${indent}    })`)
  } else if (cap.id === 'auth.login') {
    lines.push(`${indent}    const data = await oauthDeviceLogin({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      interactive: ctx.isTty,`)
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}    })`)
  } else if (cap.id === 'auth.logout') {
    lines.push(`${indent}    const data = await logoutAuthSession({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      all: ctx.options.all === true,`)
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}    })`)
  }
  lines.push(`${indent}    return ctx.ok(data, { execution: { mode: 'local', source: 'schema-default' } })`)
  lines.push(`${indent}  },`)
  lines.push(`${indent}}),`)
  return lines
}

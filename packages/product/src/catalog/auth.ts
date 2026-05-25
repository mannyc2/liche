import type {
  AuthCommandSpec,
  AuthIdentitySpec,
  AuthSpec,
  ContextSpec,
  PermissionSpec,
  ProductContextEntry,
  TokenSource,
} from '../auth/types.js'
import type { EffectKind } from '../command/types.js'
import { normalizeHttpSpec } from './http.js'
import type {
  CommandCapability,
  NormalizedAuth,
  NormalizedAuthCommands,
  NormalizedAuthIdentity,
  NormalizedContext,
  NormalizedContextSelect,
  NormalizedPermission,
  NormalizedTokenSource,
} from './types.js'

export function normalizeAuth(spec: AuthSpec): NormalizedAuth {
  if (spec.kind === 'none') return { kind: 'none' }
  const tokenSources = spec.sources.map(normalizeTokenSource)
  const out: NormalizedAuth = {
    kind: spec.kind,
    id: spec.id,
    tokenSources,
  }
  if (spec.kind === 'oauthDevice') {
    out.tokenKind = spec.token.kind
    if (spec.token.header) out.header = spec.token.header
    if (spec.commands) out.commands = normalizeAuthCommands(spec.commands)
    if (spec.identity) out.identity = normalizeAuthIdentity(spec.identity)
    out.oauthDevice = {
      clientId: spec.clientId,
      endpoints: { ...spec.endpoints },
      ...(spec.scopes ? { scopes: [...spec.scopes] } : undefined),
    }
  } else if (spec.header) out.header = spec.header
  const sessionSource = tokenSources.find((source) => source.kind === 'session')
  if (sessionSource) out.session = { enabled: true, profiles: sessionSource.profiles }
  return out
}

function normalizeTokenSource(source: TokenSource): NormalizedTokenSource {
  if (source.kind === 'session') {
    return {
      kind: 'session',
      profiles: source.profiles !== false,
      refresh: source.refresh === true,
    }
  }
  const out: NormalizedTokenSource = {
    kind: 'env',
    envVar: source.envVar,
    mode: source.mode ?? 'any',
  }
  if (source.label) out.label = source.label
  if (source.scopes) out.scopes = [...source.scopes]
  return out
}

function normalizeAuthCommands(commands: AuthCommandSpec): NormalizedAuthCommands {
  const out: NormalizedAuthCommands = {}
  if (commands.login) out.login = commands.login
  if (commands.logout) out.logout = commands.logout
  if (commands.switch) out.switch = commands.switch
  if (commands.whoami) out.whoami = commands.whoami
  return out
}

function normalizeAuthIdentity(identity: AuthIdentitySpec): NormalizedAuthIdentity {
  const out: NormalizedAuthIdentity = {
    http: normalizeHttpSpec(identity.http),
    subject: identity.subject,
  }
  if (identity.label) out.label = identity.label
  return out
}

export function normalizeAuthCapabilities(auth: NormalizedAuth, contexts: NormalizedContext[]): CommandCapability[] {
  if (auth.kind === 'none' || !auth.commands) return []
  const out: CommandCapability[] = []
  const hasSession = auth.tokenSources.some((source) => source.kind === 'session')
  if (auth.commands.whoami && (auth.identity || hasSession)) {
    out.push(authCapability('auth.whoami', auth.commands.whoami, 'Show current authentication status', 'auth-session-read', true))
  }
  if (auth.commands.switch && hasSession && auth.session?.profiles && contexts.length > 0) {
    out.push(authCapability('auth.switch', auth.commands.switch, 'Switch stored auth context', 'auth-context-write', false))
  }
  if (auth.commands.login && auth.kind === 'oauthDevice' && hasSession) {
    out.push(authCapability('auth.login', auth.commands.login, 'Log in with OAuth device flow', 'auth-session-write', false))
  }
  if (auth.commands.logout && hasSession) {
    out.push(authCapability('auth.logout', auth.commands.logout, 'Log out of stored auth session', 'auth-session-delete', false))
  }
  return out
}

function authCapability(
  id: string,
  command: string,
  summary: string,
  effect: EffectKind,
  agent: boolean,
): CommandCapability {
  return {
    kind: 'command',
    id,
    family: 'auth',
    command: [command],
    generated: true,
    summary,
    examples: [],
    execution: { mode: 'local', handler: id, needs: [] },
    effects: { kind: effect },
    policy: {
      dangerous: false,
      requiresConfirmation: false,
      conformanceEligible: false,
    },
    requires: { auth: false, contexts: [], permissions: [] },
    surfaces: {
      cli: true,
      cliCommand: command,
      docs: true,
      dashboard: false,
      agent,
      openapi: false,
    },
  }
}

export function normalizePermissions(specs: Readonly<Record<string, PermissionSpec>>): NormalizedPermission[] {
  return Object.keys(specs).sort().map((id) => {
    const spec = specs[id]!
    const out: NormalizedPermission = { id }
    if (spec.kind === 'scope') out.scope = spec.scope
    if (spec.description) out.description = spec.description
    return out
  })
}

export function normalizeContext(entry: ProductContextEntry): NormalizedContext {
  const { id, spec } = entry
  const out: NormalizedContext = {
    id,
    source: spec.kind,
    select: normalizeContextSelect(spec),
  }
  if (spec.label) out.label = spec.label
  if (spec.kind === 'remote') {
    if (spec.idField) out.idField = spec.idField
    if (spec.nameField) out.nameField = spec.nameField
    if (spec.list) out.list = normalizeHttpSpec(spec.list.http)
  }
  return out
}

function normalizeContextSelect(spec: ContextSpec): NormalizedContextSelect {
  const out: NormalizedContextSelect = {}
  if (spec.select.flag) out.flag = spec.select.flag
  if (spec.select.env) out.env = spec.select.env
  return out
}

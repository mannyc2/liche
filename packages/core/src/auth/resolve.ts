import { authCiTokenMissing, authContextRequired, authExpired, authMissing, authScopeMissing } from './errors.js'
import { secret } from './secret.js'
import type {
  AuthCredential,
  AuthProviderRuntime,
  ContextRuntime,
  InvocationKind,
  SessionStore,
  StoredProfile,
} from './types.js'

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

export async function resolveAuth(input: ResolveAuthInput): Promise<AuthCredential | undefined> {
  const { provider, required, requiredScopes, requiredPermissions, invocation, env = {} } = input

  if (provider.kind === 'none') return undefined

  const envVarsTried: string[] = []
  for (const source of provider.tokenSources) {
    if (source.kind !== 'env') continue
    const mode = source.mode ?? 'any'
    if (mode === 'ci' && invocation !== 'ci') continue
    envVarsTried.push(source.envVar)
    const value = env[source.envVar]
    if (value && value.length > 0) {
      const credential = buildCredential(provider, value, source.scopes)
      assertScopes(provider.id, credential, requiredScopes, requiredPermissions)
      return credential
    }
  }

  const sessionSource = provider.tokenSources.find((source) => source.kind === 'session')
  if (sessionSource && input.sessionStore && input.productId && sessionAllowed(input)) {
    const profile = await resolveProfileName(input)
    const stored = await input.sessionStore.loadProfile(input.productId, provider.id, profile)
    const credential = credentialFromStoredProfile(provider, stored)
    if (credential) {
      if (isExpired(credential.expiresAt)) throw authExpired({ providerId: provider.id, loginCommand: input.loginCommand })
      assertScopes(provider.id, credential, requiredScopes, requiredPermissions)
      return credential
    }
  }

  if (!required) return undefined

  if (invocation === 'ci') {
    throw authCiTokenMissing({ providerId: provider.id, envVars: envVarsTried })
  }
  throw authMissing({
    providerId: provider.id,
    envVars: envVarsTried,
    loginCommand: input.loginCommand,
    ...(requiredPermissions ? { requiredPermissions } : undefined),
  })
}

async function resolveProfileName(input: ResolveAuthInput): Promise<string> {
  if (input.profile) return input.profile
  if (input.profileEnvVar) {
    const fromEnv = input.env?.[input.profileEnvVar]
    if (fromEnv) return fromEnv
  }
  if (input.productId && input.sessionStore) {
    const active = await input.sessionStore.getActiveProfile(input.productId, input.provider.id)
    if (active) return active
  }
  return 'default'
}

function sessionAllowed(input: ResolveAuthInput): boolean {
  if (input.noSession) return false
  if (input.allowStoredSession !== undefined) return input.allowStoredSession
  if (input.invocation === 'cli') return true
  if (input.invocation === 'agent' || input.invocation === 'mcp') return !!input.profile
  return false
}

function buildCredential(provider: AuthProviderRuntime, raw: string, scopes: string[] | undefined): AuthCredential {
  const kind: 'bearer' | 'apiKey' = provider.kind === 'apiKey' ? 'apiKey' : 'bearer'
  const credential: AuthCredential = {
    providerId: provider.id,
    source: 'env',
    kind,
    secret: secret(raw),
    header: provider.header,
    refreshAvailable: false,
  }
  if (scopes) credential.scopes = [...scopes]
  return credential
}

function credentialFromStoredProfile(
  provider: AuthProviderRuntime,
  profile: StoredProfile | undefined,
): AuthCredential | undefined {
  const stored = profile?.credential
  const token = stored?.accessToken
  if (!profile || !stored || !token) return undefined
  return {
    providerId: provider.id,
    source: 'session',
    profile: profile.profile,
    kind: stored.kind,
    secret: token,
    header: provider.header,
    account: profile.account,
    scopes: stored.scopes,
    expiresAt: stored.expiresAt,
    refreshAvailable: false,
  }
}

function assertScopes(
  providerId: string,
  credential: AuthCredential,
  requiredScopes: string[] | undefined,
  requiredPermissions: string[] | undefined,
): void {
  if (!requiredScopes || requiredScopes.length === 0 || !credential.scopes) return
  const missing = requiredScopes.filter((s) => !credential.scopes!.includes(s))
  if (missing.length > 0) {
    throw authScopeMissing({
      providerId,
      missingScopes: missing,
      ...(requiredPermissions ? { requiredPermissions } : undefined),
    })
  }
}

function isExpired(expiresAt: string | undefined): boolean {
  return expiresAt !== undefined && Date.parse(expiresAt) <= Date.now()
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

export async function resolveContext(input: ResolveContextInput): Promise<Record<string, string>> {
  const { contexts, required, explicit = {}, env = {}, providerId = '' } = input
  const resolved: Record<string, string> = {}
  const missing: { id: string; envVar?: string | undefined; flag?: string | undefined }[] = []

  for (const id of required) {
    const ctx = contexts.find((c) => c.id === id)
    if (!ctx) {
      missing.push({ id })
      continue
    }
    const explicitValue = ctx.flag ? explicit[ctx.flag] : undefined
    const envValue = ctx.envVar ? env[ctx.envVar] : undefined
    const storedValue = input.profile && (input.credentialSource === 'session' || input.profileExplicit)
      ? input.profile.selectedContexts?.[id]
      : undefined
    const value = explicitValue ?? envValue ?? storedValue
    if (value && value.length > 0) {
      resolved[id] = value
    } else {
      missing.push({ id, envVar: ctx.envVar, flag: ctx.flag })
    }
  }

  if (missing.length > 0) {
    throw authContextRequired({ providerId, contexts: missing })
  }

  return resolved
}

export function applyAuth(headers: Headers, credential: AuthCredential): void {
  const raw = credential.secret.reveal()
  if (credential.kind === 'bearer') {
    headers.set(credential.header ?? 'Authorization', `Bearer ${raw}`)
    return
  }
  headers.set(credential.header ?? 'x-api-key', raw)
}

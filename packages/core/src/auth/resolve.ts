import { authCiTokenMissing, authContextRequired, authMissing, authScopeMissing } from './errors.js'
import { secret } from './secret.js'
import type { AuthCredential, AuthProviderRuntime, ContextRuntime, InvocationKind, ResolvedAuthMeta } from './types.js'

export type ResolveAuthInput = {
  provider: AuthProviderRuntime
  required: boolean
  requiredScopes?: string[]
  profile?: string
  invocation: InvocationKind
  nonInteractive?: boolean
  allowStoredSession?: boolean
  env?: Record<string, string | undefined>
}

export async function resolveAuth(input: ResolveAuthInput): Promise<AuthCredential | undefined> {
  const { provider, required, requiredScopes, invocation, env = {} } = input

  if (provider.kind === 'none') return undefined

  const envVarsTried: string[] = []
  for (const source of provider.tokenSources) {
    if (source.kind !== 'env') continue
    const mode = source.mode ?? 'any'
    if (mode === 'ci' && invocation !== 'ci') continue
    envVarsTried.push(source.envVar)
    const value = env[source.envVar]
    if (value && value.length > 0) {
      const credential = buildCredential(provider, value)
      if (requiredScopes && requiredScopes.length > 0 && credential.scopes) {
        const missing = requiredScopes.filter((s) => !credential.scopes!.includes(s))
        if (missing.length > 0) {
          throw authScopeMissing({
            providerId: provider.id,
            missingScopes: missing,
            requiredPermissions: requiredScopes,
          })
        }
      }
      return credential
    }
  }

  if (!required) return undefined

  if (invocation === 'ci') {
    throw authCiTokenMissing({ providerId: provider.id, envVars: envVarsTried })
  }
  throw authMissing({ providerId: provider.id, envVars: envVarsTried })
}

function buildCredential(provider: AuthProviderRuntime, raw: string): AuthCredential {
  const kind: 'bearer' | 'apiKey' = provider.kind === 'apiKey' ? 'apiKey' : 'bearer'
  return {
    providerId: provider.id,
    source: 'env',
    kind,
    secret: secret(raw),
    header: provider.header,
    refreshAvailable: false,
  }
}

export type ResolveContextInput = {
  contexts: ContextRuntime[]
  required: string[]
  explicit?: Record<string, string | undefined>
  env?: Record<string, string | undefined>
  credentialSource?: 'env' | 'session' | 'none'
  providerId?: string
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
    const value = explicitValue ?? envValue
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

export function authMetaFromCredential(credential: AuthCredential | undefined): ResolvedAuthMeta {
  if (!credential) return { kind: 'none' }
  return {
    kind: 'resolved',
    providerId: credential.providerId,
    source: credential.source,
    profile: credential.profile,
    account: credential.account,
    scopes: credential.scopes,
    expiresAt: credential.expiresAt,
  }
}

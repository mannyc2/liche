import { secret } from '@liche/core'
import type { AuthCredential, AuthProviderRuntime } from '@liche/core'
import { authCiTokenMissing, authExpired, authMissing, authScopeMissing } from './errors.js'
import type { ResolveAuthInput, StoredProfile } from './types.js'

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
      if (credential.expiresAt !== undefined && Date.parse(credential.expiresAt) <= Date.now()) {
        throw authExpired({ providerId: provider.id, loginCommand: input.loginCommand })
      }
      assertScopes(provider.id, credential, requiredScopes, requiredPermissions)
      return credential
    }
  }

  if (!required) return undefined
  if (invocation === 'ci') throw authCiTokenMissing({ providerId: provider.id, envVars: envVarsTried })
  throw authMissing({
    providerId: provider.id,
    envVars: envVarsTried,
    loginCommand: input.loginCommand,
    ...(requiredPermissions ? { requiredPermissions } : undefined),
  })
}

async function resolveProfileName(input: ResolveAuthInput): Promise<string> {
  if (input.profile) return input.profile
  const fromEnv = input.profileEnvVar ? input.env?.[input.profileEnvVar] : undefined
  if (fromEnv) return fromEnv
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
  const credential: AuthCredential = {
    providerId: provider.id,
    source: 'env',
    kind: provider.kind === 'apiKey' ? 'apiKey' : 'bearer',
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
  if (missing.length === 0) return
  throw authScopeMissing({
    providerId,
    missingScopes: missing,
    ...(requiredPermissions ? { requiredPermissions } : undefined),
  })
}

import { authInvalid } from './errors.js'
import { applyAuth } from './http.js'
import { resolveAuth } from './resolve.js'
import type { AuthIdentityProbeInput, AuthRuntimeInput, AuthStatus, ContextRuntime, StoredProfile } from './types.js'

export async function authWhoami(input: AuthRuntimeInput): Promise<AuthStatus> {
  const profile = input.profile ?? input.global?.profile
  const credential = await resolveAuth({
    allowStoredSession: input.allowStoredSession,
    env: input.env,
    invocation: input.invocation,
    loginCommand: input.loginCommand,
    noSession: input.global?.noSession,
    nonInteractive: input.global?.nonInteractive,
    productId: input.productId,
    profile,
    profileEnvVar: input.profileEnvVar,
    provider: input.provider,
    required: false,
    sessionStore: input.sessionStore,
  })
  if (!credential) return { authenticated: false }

  const storedName = credential.profile ?? profile
  const stored = !input.global?.noSession && storedName
    ? await input.sessionStore.loadProfile(input.productId, input.provider.id, storedName)
    : undefined

  const account = input.provider.identity && input.baseUrl
    ? await probeIdentity({
        baseUrl: input.baseUrl,
        credential,
        env: input.env,
        fetch: input.fetch,
        identity: input.provider.identity,
      }).catch(() => credential.account ?? stored?.account)
    : credential.account ?? stored?.account

  return compactStatus({
    authenticated: true,
    source: credential.source,
    profile: credential.profile ?? stored?.profile ?? profile,
    account,
    contexts: stored?.selectedContexts,
    expiresAt: credential.expiresAt,
    refreshAvailable: credential.refreshAvailable,
  })
}

export async function authSwitch(input: AuthRuntimeInput & {
  contexts: ContextRuntime[]
  values: Record<string, string | undefined>
}): Promise<{ profile: string; contexts: Record<string, string> }> {
  const profile = input.profile ?? input.global?.profile ?? await activeProfile(input)
  const selectedContexts: Record<string, string> = {}
  for (const ctx of input.contexts) {
    const value = ctx.flag ? input.values[ctx.flag] : undefined
    if (value !== undefined && value !== '') selectedContexts[ctx.id] = value
  }

  const previous = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  const nowIso = new Date().toISOString()
  const stored: StoredProfile = {
    schemaVersion: 1,
    productId: input.productId,
    providerId: input.provider.id,
    profile,
    createdAt: previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
    ...(previous?.account ? { account: previous.account } : undefined),
    selectedContexts: {
      ...(previous?.selectedContexts ?? {}),
      ...selectedContexts,
    },
    ...(previous?.credential ? { credential: previous.credential } : undefined),
  }
  await input.sessionStore.saveProfile(input.productId, input.provider.id, profile, stored)
  await input.sessionStore.setActiveProfile(input.productId, input.provider.id, profile)
  return { profile, contexts: stored.selectedContexts ?? {} }
}

export async function logoutAuthSession(input: AuthRuntimeInput & { all?: boolean | undefined }): Promise<{
  authenticated: false
  deleted: number
  profile?: string | undefined
}> {
  if (input.all) {
    const deleted = await input.sessionStore.deleteAllProfiles(input.productId, input.provider.id)
    return { authenticated: false, deleted }
  }
  const profile = input.profile ?? input.global?.profile ?? await activeProfile(input)
  const exists = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  await input.sessionStore.deleteProfile(input.productId, input.provider.id, profile)
  return { authenticated: false, deleted: exists ? 1 : 0, profile }
}

export async function activeProfile(input: AuthRuntimeInput): Promise<string> {
  return input.profile
    ?? input.global?.profile
    ?? (input.profileEnvVar ? input.env?.[input.profileEnvVar] : undefined)
    ?? await input.sessionStore.getActiveProfile(input.productId, input.provider.id)
    ?? 'default'
}

export async function probeIdentity(input: AuthIdentityProbeInput): Promise<{ id: string; label?: string | undefined }> {
  const url = new URL(input.identity.http.path, resolveBaseUrl(input.baseUrl, input.env ?? {}))
  const headers = new Headers({ accept: 'application/json' })
  applyAuth(headers, input.credential)
  const response = await (input.fetch ?? fetch)(url.toString(), { headers, method: input.identity.http.method })
  if (!response.ok) throw authInvalid({ providerId: input.credential.providerId, status: response.status })
  const body = await response.json()
  const id = valueAt(body, input.identity.subject)
  if (id === undefined || id === null || id === '') throw authInvalid({ providerId: input.credential.providerId })
  const label = input.identity.label ? valueAt(body, input.identity.label) : undefined
  return {
    id: String(id),
    ...(label !== undefined && label !== null && label !== '' ? { label: String(label) } : undefined),
  }
}

function resolveBaseUrl(value: AuthIdentityProbeInput['baseUrl'], env: Record<string, string | undefined>): string {
  if (typeof value === 'string') return value
  if (value.envVar) return env[value.envVar] ?? value.literal ?? ''
  return value.literal ?? ''
}

function valueAt(input: unknown, path: string): unknown {
  let cursor: unknown = input
  for (const part of path.split('.')) {
    if (!part) continue
    cursor = (cursor as Record<string, unknown> | null | undefined)?.[part]
  }
  return cursor
}

export function compactStatus<T extends AuthStatus>(status: T): T {
  return JSON.parse(JSON.stringify(status)) as T
}

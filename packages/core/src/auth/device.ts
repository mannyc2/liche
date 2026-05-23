import { authInteractiveRequired, authInvalid } from './errors.js'
import { applyAuth, resolveAuth } from './resolve.js'
import { secret } from './secret.js'
import type {
  AuthCredential,
  AuthIdentityProbeInput,
  AuthProviderRuntime,
  ContextRuntime,
  InvocationKind,
  SessionStore,
  StoredProfile,
} from './types.js'

type AuthStatus = {
  authenticated: boolean
  source?: 'env' | 'session' | undefined
  profile?: string | undefined
  account?: { id: string; label?: string | undefined } | undefined
  contexts?: Record<string, string> | undefined
  expiresAt?: string | undefined
  refreshAvailable?: boolean | undefined
}

type DeviceCodeResponse = {
  deviceCode: string
  expiresIn: number
  interval: number
  userCode?: string | undefined
  verificationUri?: string | undefined
}

type TokenResponse = {
  accessToken: string
  expiresIn?: number | undefined
  scope?: string | undefined
}

export type AuthRuntimeInput = {
  allowStoredSession?: boolean | undefined
  baseUrl?: AuthIdentityProbeInput['baseUrl'] | undefined
  env?: Record<string, string | undefined> | undefined
  fetch?: AuthIdentityProbeInput['fetch'] | undefined
  global?: { nonInteractive?: boolean | undefined; noSession?: boolean | undefined; profile?: string | undefined } | undefined
  invocation: InvocationKind
  loginCommand?: string | undefined
  productId: string
  profile?: string | undefined
  profileEnvVar?: string | undefined
  provider: AuthProviderRuntime
  sessionStore: SessionStore
}

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

  const stored = await loadProfileForCredential(input, credential, profile)
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
  const now = new Date().toISOString()
  const stored: StoredProfile = {
    schemaVersion: 1,
    productId: input.productId,
    providerId: input.provider.id,
    profile,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
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

export async function oauthDeviceLogin(input: AuthRuntimeInput & { interactive?: boolean | undefined }): Promise<AuthStatus & {
  verificationUri?: string | undefined
  userCode?: string | undefined
}> {
  const oauth = input.provider.oauthDevice
  if (!oauth) throw authInvalid({ providerId: input.provider.id })
  if (input.invocation !== 'cli' || input.global?.nonInteractive || input.interactive === false) {
    throw authInteractiveRequired({ providerId: input.provider.id, loginCommand: input.loginCommand })
  }

  const profile = input.profile ?? input.global?.profile ?? await activeProfile(input)
  const device = await requestDeviceCode(oauth.endpoints.deviceAuthorization, {
    client_id: oauth.clientId,
    ...(oauth.scopes?.length ? { scope: oauth.scopes.join(' ') } : undefined),
  }, input.fetch)
  const token = await pollDeviceToken(oauth.endpoints.token, {
    client_id: oauth.clientId,
    device_code: device.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  }, {
    expiresIn: device.expiresIn,
    fetch: input.fetch,
    interval: device.interval,
    providerId: input.provider.id,
  })

  const expiresAt = token.expiresIn !== undefined
    ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
    : undefined
  const credential: AuthCredential = {
    providerId: input.provider.id,
    source: 'session',
    profile,
    kind: input.provider.tokenKind === 'apiKey' || input.provider.kind === 'apiKey' ? 'apiKey' : 'bearer',
    secret: secret(token.accessToken),
    header: input.provider.header,
    expiresAt,
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : oauth.scopes,
    refreshAvailable: false,
  }
  const account = input.provider.identity && input.baseUrl
    ? await probeIdentity({
        baseUrl: input.baseUrl,
        credential,
        env: input.env,
        fetch: input.fetch,
        identity: input.provider.identity,
      }).catch(() => undefined)
    : undefined

  const now = new Date().toISOString()
  const previous = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  await input.sessionStore.saveProfile(input.productId, input.provider.id, profile, {
    schemaVersion: 1,
    productId: input.productId,
    providerId: input.provider.id,
    profile,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(account ? { account } : previous?.account ? { account: previous.account } : undefined),
    ...(previous?.selectedContexts ? { selectedContexts: previous.selectedContexts } : undefined),
    credential: {
      kind: credential.kind,
      accessToken: credential.secret,
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : undefined),
      ...(credential.scopes ? { scopes: credential.scopes } : undefined),
    },
  })
  await input.sessionStore.setActiveProfile(input.productId, input.provider.id, profile)

  return compactStatus({
    authenticated: true,
    source: 'session',
    profile,
    account,
    expiresAt,
    refreshAvailable: false,
    verificationUri: device.verificationUri,
    userCode: device.userCode,
  })
}

async function probeIdentity(input: AuthIdentityProbeInput): Promise<{ id: string; label?: string | undefined }> {
  const url = new URL(input.identity.http.path, resolveBaseUrl(input.baseUrl, input.env ?? {}))
  const headers = new Headers({ accept: 'application/json' })
  applyAuth(headers, input.credential)
  const fetcher = input.fetch ?? fetch
  const response = await fetcher(url.toString(), { headers, method: input.identity.http.method })
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

async function loadProfileForCredential(
  input: AuthRuntimeInput,
  credential: AuthCredential,
  requestedProfile: string | undefined,
): Promise<StoredProfile | undefined> {
  if (input.global?.noSession) return undefined
  const profile = credential.profile ?? requestedProfile
  if (!profile) return undefined
  return await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
}

async function activeProfile(input: AuthRuntimeInput): Promise<string> {
  return input.profile
    ?? input.global?.profile
    ?? (input.profileEnvVar ? input.env?.[input.profileEnvVar] : undefined)
    ?? await input.sessionStore.getActiveProfile(input.productId, input.provider.id)
    ?? 'default'
}

async function requestDeviceCode(
  endpoint: string,
  body: Record<string, string>,
  fetcher: AuthIdentityProbeInput['fetch'],
): Promise<DeviceCodeResponse> {
  const response = await postForm(endpoint, body, fetcher)
  if (!response.ok) throw authInvalid({ providerId: 'oauth-device', status: response.status })
  const raw = await response.json() as Record<string, unknown>
  const deviceCode = raw['device_code']
  if (typeof deviceCode !== 'string' || deviceCode.length === 0) {
    throw authInvalid({ providerId: 'oauth-device', status: response.status })
  }
  const verificationUri = raw['verification_uri_complete'] ?? raw['verification_uri']
  return {
    deviceCode,
    expiresIn: Number(raw['expires_in'] ?? 900),
    interval: Number(raw['interval'] ?? 5),
    ...(typeof raw['user_code'] === 'string' ? { userCode: raw['user_code'] } : undefined),
    ...(typeof verificationUri === 'string' ? { verificationUri } : undefined),
  }
}

async function pollDeviceToken(
  endpoint: string,
  body: Record<string, string>,
  options: { expiresIn: number; fetch?: AuthIdentityProbeInput['fetch']; interval: number; providerId: string },
): Promise<TokenResponse> {
  const startedAt = Date.now()
  let interval = Math.max(1, options.interval)
  while (Date.now() - startedAt < options.expiresIn * 1000) {
    const response = await postForm(endpoint, body, options.fetch)
    const parsed = await response.json().catch(() => ({})) as Record<string, unknown>
    if (response.ok && typeof parsed['access_token'] === 'string') {
      return {
        accessToken: parsed['access_token'],
        ...(parsed['expires_in'] !== undefined ? { expiresIn: Number(parsed['expires_in']) } : undefined),
        ...(typeof parsed['scope'] === 'string' ? { scope: parsed['scope'] } : undefined),
      }
    }
    if (parsed['error'] === 'authorization_pending') {
      await sleep(interval * 1000)
      continue
    }
    if (parsed['error'] === 'slow_down') {
      interval += 5
      await sleep(interval * 1000)
      continue
    }
    throw authInvalid({ providerId: options.providerId, status: response.status })
  }
  throw authInvalid({ providerId: options.providerId })
}

async function postForm(
  endpoint: string,
  body: Record<string, string>,
  fetcher: AuthIdentityProbeInput['fetch'],
): Promise<Response> {
  const params = new URLSearchParams(body)
  return await (fetcher ?? fetch)(endpoint, {
    body: params,
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })
}

function resolveBaseUrl(value: AuthIdentityProbeInput['baseUrl'], env: Record<string, string | undefined>): string {
  if (typeof value === 'string') return value
  if (value.envVar) return env[value.envVar] ?? value.literal ?? ''
  return value.literal ?? ''
}

function valueAt(input: unknown, path: string): unknown {
  let cursor = input as any
  for (const part of path.split('.')) {
    if (!part) continue
    cursor = cursor?.[part]
  }
  return cursor
}

function compactStatus<T extends AuthStatus>(status: T): T {
  return JSON.parse(JSON.stringify(status)) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

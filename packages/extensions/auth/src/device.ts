import { secret } from '@liche/core'
import { authInvalid, authInteractiveRequired } from './errors.js'
import { activeProfile, compactStatus, probeIdentity } from './session.js'
import type { AuthCredential, AuthIdentityProbeInput, AuthRuntimeInput, AuthStatus } from './types.js'

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

export async function oauthDeviceLogin(input: AuthRuntimeInput & { interactive?: boolean | undefined }): Promise<
  AuthStatus & {
    verificationUri?: string | undefined
    userCode?: string | undefined
  }
> {
  const oauth = input.provider.oauthDevice
  if (!oauth) throw authInvalid({ providerId: input.provider.id })
  if (input.invocation !== 'cli' || input.global?.nonInteractive || input.interactive === false) {
    throw authInteractiveRequired({ providerId: input.provider.id, loginCommand: input.loginCommand })
  }

  const profile = input.profile ?? input.global?.profile ?? (await activeProfile(input))
  const device = await requestDeviceCode(
    oauth.endpoints.deviceAuthorization,
    {
      client_id: oauth.clientId,
      ...(oauth.scopes?.length ? { scope: oauth.scopes.join(' ') } : undefined),
    },
    input.fetch,
  )
  const token = await pollDeviceToken(
    oauth.endpoints.token,
    {
      client_id: oauth.clientId,
      device_code: device.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    },
    {
      expiresIn: device.expiresIn,
      fetch: input.fetch,
      interval: device.interval,
      providerId: input.provider.id,
    },
  )

  const expiresAt =
    token.expiresIn !== undefined ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : undefined
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
  const account =
    input.provider.identity && input.baseUrl
      ? await probeIdentity({
          baseUrl: input.baseUrl,
          credential,
          env: input.env,
          fetch: input.fetch,
          identity: input.provider.identity,
        }).catch(() => undefined)
      : undefined

  const nowIso = new Date().toISOString()
  const previous = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  await input.sessionStore.saveProfile(input.productId, input.provider.id, profile, {
    schemaVersion: 1,
    productId: input.productId,
    providerId: input.provider.id,
    profile,
    createdAt: previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
    ...(account ? { account } : previous?.account ? { account: previous.account } : undefined),
    ...(previous?.selectedContexts ? { selectedContexts: previous.selectedContexts } : undefined),
    credential: {
      kind: credential.kind,
      accessToken: credential.secret,
      ...(expiresAt ? { expiresAt } : undefined),
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

async function requestDeviceCode(
  endpoint: string,
  body: Record<string, string>,
  fetcher: AuthIdentityProbeInput['fetch'],
): Promise<DeviceCodeResponse> {
  const response = await postForm(endpoint, body, fetcher)
  if (!response.ok) throw authInvalid({ providerId: 'oauth-device', status: response.status })
  const raw = (await response.json()) as Record<string, unknown>
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
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (response.ok && typeof parsed['access_token'] === 'string') {
      return {
        accessToken: parsed['access_token'],
        ...(parsed['expires_in'] !== undefined ? { expiresIn: Number(parsed['expires_in']) } : undefined),
        ...(typeof parsed['scope'] === 'string' ? { scope: parsed['scope'] } : undefined),
      }
    }
    if (parsed['error'] === 'authorization_pending') {
      await new Promise((r) => setTimeout(r, interval * 1000))
      continue
    }
    if (parsed['error'] === 'slow_down') {
      interval += 5
      await new Promise((r) => setTimeout(r, interval * 1000))
      continue
    }
    throw authInvalid({ providerId: options.providerId, status: response.status })
  }
  throw authInvalid({ providerId: options.providerId })
}

function postForm(
  endpoint: string,
  body: Record<string, string>,
  fetcher: AuthIdentityProbeInput['fetch'],
): Promise<Response> {
  return (fetcher ?? fetch)(endpoint, {
    body: new URLSearchParams(body),
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })
}

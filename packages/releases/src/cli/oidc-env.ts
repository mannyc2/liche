import { loadPublisherCredentialsFromEnv } from '../publishers/index.js'
import type { EnvRecord, OidcExchangeEnv, PublisherCredentials } from '../publishers/index.js'

export function releaseVersionFromRef(env: EnvRecord): string | undefined {
  const fullRef = env['GITHUB_REF']
  const refName = env['GITHUB_REF_NAME']
  const ref = fullRef?.startsWith('refs/tags/')
    ? fullRef.slice('refs/tags/'.length)
    : env['GITHUB_REF_TYPE'] === 'tag'
      ? refName
      : refName?.startsWith('v')
        ? refName
        : undefined
  if (!ref) return undefined
  const name = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : ref
  return name.startsWith('v') ? name.slice(1) : name
}

export function githubActionsOidcEnv(env: EnvRecord): OidcExchangeEnv | undefined {
  const requestUrl = env['ACTIONS_ID_TOKEN_REQUEST_URL']
  const requestToken = env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
  if (!requestUrl || !requestToken) return undefined
  return {
    idTokenFetcher: async (audience) => {
      const url = new URL(requestUrl)
      url.searchParams.set('audience', audience)
      const response = await fetch(url, { headers: { Authorization: `Bearer ${requestToken}` } })
      if (!response.ok) return { ok: false, reason: `GitHub OIDC token request failed with ${response.status}` }
      const body = (await response.json()) as { value?: unknown; token?: unknown }
      const token = typeof body.value === 'string' ? body.value : body.token
      return typeof token === 'string' && token.length > 0
        ? { ok: true, token }
        : { ok: false, reason: 'GitHub OIDC token response did not include a token' }
    },
  }
}

export function publisherCredentials(env: EnvRecord): { credentials: PublisherCredentials; oidc?: OidcExchangeEnv } {
  const credentials = loadPublisherCredentialsFromEnv(env)
  const oidc = githubActionsOidcEnv(env)
  if (!credentials.npm && oidc) credentials.npm = { kind: 'oidc', provider: 'github-actions' }
  return oidc ? { credentials, oidc } : { credentials }
}

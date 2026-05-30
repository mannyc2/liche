export type OidcIdTokenResult = { ok: true; token: string } | { ok: false; reason: string }

export type OidcIdTokenFetcher = (audience: string) => Promise<OidcIdTokenResult>

export type OidcExchangeEnv = {
  idTokenFetcher: OidcIdTokenFetcher
}

// Canonical npm trusted-publishing audience for the public registry.
// Source: https://docs.npmjs.com/trusted-publishers/
export const DEFAULT_NPM_REGISTRY_AUDIENCE = 'npm:registry.npmjs.org'

// Derive the OIDC audience for an npm registry URL.
// Strip scheme + trailing slash, prepend 'npm:'.
export function audienceForNpmRegistry(registry: string): string {
  const trimmed = registry.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `npm:${trimmed}`
}

// npm OIDC token exchange endpoint for a given package. Caller POSTs the
// OIDC ID token with 'Authorization: Bearer <token>' and receives a
// short-lived publish token. Source: https://api-docs.npmjs.com/
export function npmOidcExchangeUrl(registry: string, packageName: string): string {
  const base = registry.replace(/\/+$/, '')
  return `${base}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(packageName)}`
}

// Executor-side OIDC failure codes — reserved here so per-ecosystem
// executors return them consistently. The orchestrator does not
// emit these directly; they surface through EXECUTOR_FAILED with
// `details.executorCode` set to the value below.
export const OIDC_EXECUTOR_FAILURE_CODES = [
  'TRUSTED_PUBLISHER_MISMATCH',
  'OIDC_EXCHANGE_FAILED',
  'OIDC_AUDIENCE_UNRESOLVABLE',
  'OIDC_TOKEN_FETCH_FAILED',
] as const
export type OidcExecutorFailureCode = (typeof OIDC_EXECUTOR_FAILURE_CODES)[number]

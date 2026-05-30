export type AuthManifestEntry = {
  id: string
  kind: 'none' | 'bearer' | 'apiKey' | 'oauthDevice'
  credentialTransport?: 'bearer' | 'apiKey'
  modes: Array<'env' | 'session' | 'oauth-device'>
  commands?: { login?: string; logout?: string; switch?: string; whoami?: string }
  envVars: Array<{ name: string; purpose: 'bearer-token' | 'api-key'; mode: 'any' | 'ci' }>
  contexts: Array<{ id: string; envVar?: string; flag?: string; source: 'env' | 'remote' }>
  sessionStorage?: {
    keychainRequired: boolean
    profiles: boolean
    storesAccessTokens: boolean
    storesRefreshTokens: boolean
    used: boolean
  }
  requiredRuntimeCapabilities: Array<'env' | 'filesystem' | 'tty-for-login'>
}

export type ManifestAuth = {
  providers: AuthManifestEntry[]
}

export type GeneratedSurfaceManifest = {
  // `number`, not the literal `1`: a literal makes `expected !== actual` statically unreachable, which
  // dead-codes the version-drift check in manifestEqualForSurface (and narrows it to `never`).
  manifestVersion: number
  schema: {
    name: string
    version: string
    digest: string
  }
  generatorVersion: string
  auth: ManifestAuth
  surfaces: Array<{
    id: string
    source: 'catalog' | 'openapi'
    inputDigest: string
    generationOptionsDigest: string
    outputDigest: string
    artifacts: string[]
  }>
}

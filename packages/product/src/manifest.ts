import { createHash } from 'node:crypto'
import type { Catalog, NormalizedAuth, NormalizedContext } from './catalog.js'

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
  manifestVersion: 1
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

export function hashString(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

export function buildAuthManifest(catalog: Catalog): ManifestAuth {
  return { providers: [buildAuthEntry(catalog.auth, catalog.contexts)] }
}

function buildAuthEntry(auth: NormalizedAuth, contexts: NormalizedContext[]): AuthManifestEntry {
  const contextEntries = contexts.map((c) => {
    const out: AuthManifestEntry['contexts'][number] = { id: c.id, source: c.source }
    if (c.select.flag !== undefined) out.flag = c.select.flag
    if (c.select.env !== undefined) out.envVar = c.select.env
    return out
  })
  if (auth.kind === 'none') {
    return {
      id: 'none',
      kind: 'none',
      modes: [],
      envVars: [],
      contexts: contextEntries,
      requiredRuntimeCapabilities: [],
    }
  }
  const transport: 'bearer' | 'apiKey' = auth.kind === 'apiKey' || auth.tokenKind === 'apiKey' ? 'apiKey' : 'bearer'
  const purpose: 'bearer-token' | 'api-key' = transport === 'apiKey' ? 'api-key' : 'bearer-token'
  const envSources = auth.tokenSources.filter((source) => source.kind === 'env')
  const hasSession = auth.tokenSources.some((source) => source.kind === 'session')
  const modes: AuthManifestEntry['modes'] = [
    ...(envSources.length > 0 ? ['env' as const] : []),
    ...(hasSession ? ['session' as const] : []),
    ...(auth.kind === 'oauthDevice' ? ['oauth-device' as const] : []),
  ]
  const runtime: AuthManifestEntry['requiredRuntimeCapabilities'] = [
    ...(envSources.length > 0 ? ['env' as const] : []),
    ...(hasSession ? ['filesystem' as const] : []),
    ...(auth.kind === 'oauthDevice' ? ['tty-for-login' as const] : []),
  ]
  return {
    id: auth.id,
    kind: auth.kind,
    credentialTransport: transport,
    modes,
    ...(auth.commands ? { commands: auth.commands } : undefined),
    envVars: envSources.map((s) => ({ name: s.envVar, purpose, mode: s.mode })),
    contexts: contextEntries,
    ...(hasSession ? {
      sessionStorage: {
        used: true,
        profiles: auth.session?.profiles === true,
        storesAccessTokens: true,
        storesRefreshTokens: false,
        keychainRequired: false,
      },
    } : undefined),
    requiredRuntimeCapabilities: runtime,
  }
}

export function manifestEqualForSurface(
  expected: GeneratedSurfaceManifest,
  actual: GeneratedSurfaceManifest,
  surfaceId: string,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  if (expected.manifestVersion !== actual.manifestVersion) {
    reasons.push(
      `manifestVersion changed (was ${actual.manifestVersion}, now ${expected.manifestVersion})`,
    )
  }
  if (expected.schema.name !== actual.schema.name) {
    reasons.push(`schema name changed (was ${actual.schema.name}, now ${expected.schema.name})`)
  }
  if (expected.schema.version !== actual.schema.version) {
    reasons.push(`schema version changed (was ${actual.schema.version}, now ${expected.schema.version})`)
  }
  if (expected.schema.digest !== actual.schema.digest) {
    reasons.push(`schema digest changed (was ${actual.schema.digest}, now ${expected.schema.digest})`)
  }
  if (expected.generatorVersion !== actual.generatorVersion) {
    reasons.push(
      `generatorVersion changed (was ${actual.generatorVersion}, now ${expected.generatorVersion})`,
    )
  }
  if (JSON.stringify(expected.auth) !== JSON.stringify(actual.auth)) {
    reasons.push('manifest auth metadata changed')
  }
  const expectedSurface = expected.surfaces.find((s) => s.id === surfaceId)
  const actualSurface = actual.surfaces.find((s) => s.id === surfaceId)
  if (!expectedSurface || !actualSurface) {
    reasons.push(`surface '${surfaceId}' missing from one side`)
    return { ok: false, reasons }
  }
  if (expectedSurface.inputDigest !== actualSurface.inputDigest) {
    reasons.push(`surface '${surfaceId}' inputDigest changed`)
  }
  if (expectedSurface.source !== actualSurface.source) {
    reasons.push(`surface '${surfaceId}' source changed`)
  }
  if (expectedSurface.generationOptionsDigest !== actualSurface.generationOptionsDigest) {
    reasons.push(`surface '${surfaceId}' generationOptionsDigest changed`)
  }
  if (expectedSurface.outputDigest !== actualSurface.outputDigest) {
    reasons.push(`surface '${surfaceId}' output digest mismatch`)
  }
  if (!stringArraysEqual(expectedSurface.artifacts, actualSurface.artifacts)) {
    reasons.push(`surface '${surfaceId}' artifacts changed`)
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

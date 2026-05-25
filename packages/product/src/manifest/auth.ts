import type { Catalog, NormalizedAuth, NormalizedContext } from '../catalog/types.js'
import type { AuthManifestEntry, ManifestAuth } from './types.js'

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

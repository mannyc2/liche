import type { Catalog } from '../catalog/types.js'

export function secretValues(catalog: Catalog, env: Record<string, string | undefined>): string[] {
  if (catalog.auth.kind === 'none') return []
  return catalog.auth.tokenSources.flatMap((source) => {
    if (source.kind !== 'env') return []
    const value = env[source.envVar]
    return value ? [value] : []
  })
}

export function redact(value: string, secrets: readonly string[]): string {
  let out = value
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]')
  out = out.replace(/(["']?(?:api[_-]?key|token|secret)["']?\s*[:=]\s*["'])[^"',\s]+(["'])?/gi, '$1[redacted]$2')
  return out
}

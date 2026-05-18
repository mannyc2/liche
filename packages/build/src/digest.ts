import { createHash } from 'node:crypto'

export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'function') {
    throw new Error('canonicalize: functions are not digestable')
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = canonicalize(v)
    }
    return out
  }
  return value
}

export function canonicalDigest(value: unknown): string {
  const canonical = canonicalize(value)
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return `sha256:${hash}`
}

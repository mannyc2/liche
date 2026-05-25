import type { Dict, InputSourceProvenance } from '@liche/core'

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function mergeLayer(
  target: Dict,
  sources: Map<string, InputSourceProvenance>,
  layer: Dict,
  source: InputSourceProvenance,
  prefix = '',
): void {
  for (const [key, value] of Object.entries(layer)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isObject(value) && isObject(target[key])) {
      mergeLayer(target[key] as Dict, sources, value as Dict, source, path)
      continue
    }
    target[key] = value
    markSources(sources, value, source, path)
  }
}

function markSources(
  sources: Map<string, InputSourceProvenance>,
  value: unknown,
  source: InputSourceProvenance,
  prefix = '',
): void {
  if (prefix) sources.set(prefix, source)
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    markSources(sources, nested, source, path)
  }
}

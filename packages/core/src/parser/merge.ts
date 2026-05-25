import type { ConfigValueSource, Dict } from '../types.js'
import { isObject } from '../internal.js'

export function mergeLayer(
  target: Dict,
  sources: Map<string, ConfigValueSource>,
  layer: Dict,
  source: ConfigValueSource,
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
  sources: Map<string, ConfigValueSource>,
  value: unknown,
  source: ConfigValueSource,
  prefix = '',
): void {
  if (prefix) sources.set(prefix, source)
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    markSources(sources, nested, source, path)
  }
}

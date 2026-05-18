import { encode as encodeToon } from '@toon-format/toon'
import { stringify as yamlStringify } from 'yaml'
import type { Format } from '../types.js'

export { pick } from './filter.js'
export { tokenCount, tokenSlice } from './tokens.js'
export { formatCta } from './cta.js'

export function format(value: unknown, outputFormat: Format = 'toon'): string {
  switch (outputFormat) {
    case 'json':
      return JSON.stringify(value ?? null, null, 2)
    case 'jsonl':
      return (Array.isArray(value) ? value : [value]).map((item) => JSON.stringify(item ?? null)).join('\n')
    case 'md':
      return typeof value === 'string' ? value : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
    case 'yaml':
      return yamlStringify(value).trimEnd()
    case 'toon':
    default:
      return encodeToon(value)
  }
}

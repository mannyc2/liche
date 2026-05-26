import { defineExtension } from '@liche/core'
import type { CliExtension, GlobalInputDefinition, OutputTransform } from '@liche/core'
import { tokenCount, tokenSlice } from './tokens.js'

export { tokenCount, tokenSlice } from './tokens.js'

export type TokensOptions = {
  count?: boolean | undefined
  limit?: boolean | undefined
  offset?: boolean | undefined
}

export function tokens(options: TokensOptions = {}): CliExtension {
  const globals: GlobalInputDefinition[] = []
  const bufferingFlagKeys: string[] = []

  if (enabled(options, 'count')) {
    globals.push({ expose: 'runtime', flag: 'token-count', key: 'tokenCount', type: 'boolean' })
    bufferingFlagKeys.push('tokenCount')
  }
  if (enabled(options, 'limit')) {
    globals.push({ expose: 'runtime', flag: 'token-limit', key: 'tokenLimit', parse: parseFiniteNumber, type: 'string', valueLabel: 'n' })
    bufferingFlagKeys.push('tokenLimit')
  }
  if (enabled(options, 'offset')) {
    globals.push({ expose: 'runtime', flag: 'token-offset', key: 'tokenOffset', parse: parseFiniteNumber, type: 'string', valueLabel: 'n' })
    bufferingFlagKeys.push('tokenOffset')
  }

  const transform: OutputTransform = {
    id: 'liche.tokens',
    bufferingFlagKeys,
    transform(text, { flags }) {
      const tokenCountFlag = flags['tokenCount']
      const tokenLimitFlag = flags['tokenLimit']
      const tokenOffsetFlag = flags['tokenOffset']
      let out = tokenCountFlag ? String(tokenCount(text)) : text
      if (tokenLimitFlag !== undefined || tokenOffsetFlag !== undefined) {
        const offset = typeof tokenOffsetFlag === 'number' ? tokenOffsetFlag : 0
        const limit = typeof tokenLimitFlag === 'number' ? tokenLimitFlag : Infinity
        out = tokenSlice(out, offset, limit)
      }
      return out
    },
  }

  return defineExtension({
    id: 'liche.tokens',
    ...(globals.length ? { globals } : undefined),
    outputTransforms: [transform],
  })
}

function enabled<T extends Record<string, unknown>>(opts: T | undefined, key: keyof T): boolean {
  return opts === undefined || opts[key] === undefined || opts[key] === true
}

function parseFiniteNumber(value: string, flag: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || value.trim() === '') {
    throw new Error(`Invalid value for --${flag}: "${value}"`)
  }
  return n
}

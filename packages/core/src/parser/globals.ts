import type { Format, GlobalFlags } from '../types.js'
import { ParseError } from '../errors/error.js'
import { globalRegistryFor, type RuntimeGlobalInput } from '../globals/registry.js'

export type { GlobalFlags }

export function parseGlobals(
  argv: string[],
  globals?: readonly RuntimeGlobalInput[] | undefined,
): GlobalFlags {
  const flags: GlobalFlags = { rest: [] }
  const registry = globals ?? globalRegistryFor({})
  const byFlag = new Map(registry.map((global) => [global.flag, global]))
  const byAlias = new Map(registry.flatMap((global) => global.alias ? [[global.alias, global] as const] : []))

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    const long = token.startsWith('--') ? token.slice(2) : undefined
    const [key, equalsValue] = long?.split(/=(.*)/s) ?? []
    const global = key !== undefined
      ? byFlag.get(key)
      : token.startsWith('-') && token.length === 2
        ? byAlias.get(token.slice(1))
        : undefined
    if (!global) {
      flags.rest.push(token)
      continue
    }

    const usesEquals = equalsValue !== undefined
    const needsValue = global.type !== 'boolean'
    if (!needsValue && usesEquals) {
      flags.rest.push(token)
      continue
    }
    let value: string | undefined
    if (usesEquals) value = equalsValue
    else if (needsValue) value = argv[++index]

    if (needsValue && (value === undefined || value === '')) {
      throw new ParseError({ message: `Missing value for flag: --${global.flag}` })
    }

    try {
      flags[global.key] = needsValue
        ? global.parse
          ? global.parse(value!, global.flag)
          : value
        : true
    } catch (error) {
      throw new ParseError({ message: error instanceof Error ? error.message : String(error) })
    }

    if (global.key === 'json') {
      flags.formatExplicit = true
    } else if (global.key === 'format') {
      flags.formatExplicit = true
      flags.format = flags.format as Format
    }
  }

  return flags
}

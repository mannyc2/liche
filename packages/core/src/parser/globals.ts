import type { Format, GlobalFlags } from '../types.js'
import { ParseError } from '../errors/error.js'
import { globalRegistryFor, type RuntimeGlobalInput } from '../globals/registry.js'
import { flagValue, splitFlag } from './flags.js'

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
    const isLong = token.startsWith('--')
    const { name, equalsValue } = isLong ? splitFlag(token.slice(2)) : { name: '', equalsValue: undefined }
    const global = isLong
      ? byFlag.get(name)
      : token.startsWith('-') && token.length === 2
        ? byAlias.get(token.slice(1))
        : undefined
    if (!global) {
      flags.rest.push(token)
      continue
    }

    const needsValue = global.type !== 'boolean'
    const value = flagValue(needsValue, equalsValue, () => argv[++index])

    if (!needsValue) {
      // A boolean flag given a non-boolean =value (e.g. `--json=banana`) isn't ours; leave it for `rest`.
      if (typeof value !== 'boolean') {
        flags.rest.push(token)
        continue
      }
      flags[global.key] = value
    } else {
      // A value flag with no value token at all (a bare `--format` at end of argv) is a hard error; an
      // explicit empty `--format=` is "" and is left for the flag's own parse() to accept or reject.
      if (typeof value !== 'string') {
        throw new ParseError({ message: `Missing value for flag: --${global.flag}` })
      }
      try {
        flags[global.key] = global.parse ? global.parse(value, global.flag) : value
      } catch (error) {
        throw new ParseError({ message: error instanceof Error ? error.message : String(error) })
      }
    }

    if (global.key === 'json') {
      flags.formatExplicit = true
    } else if (global.key === 'format') {
      flags.formatExplicit = true
      flags.format = flags.format as Format
    }
  }

  for (const global of registry) {
    if (flags[global.key] === undefined && global.default !== undefined) {
      flags[global.key] = global.default
    }
  }

  return flags
}

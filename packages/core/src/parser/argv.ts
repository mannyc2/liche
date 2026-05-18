import type { CommandDefinition, Dict, Schema } from '../types.js'
import { camel, kebab } from '../internal.js'
import { isBooleanSchema, isDeprecated, isObjectSchema, objectShape, parseSchema } from '../schema/zod.js'

export type DeprecationWarning = { flag: string; option: string }

export function parseArgs(schema: Schema | undefined, values: string[]): unknown {
  if (!schema) return values.length ? values : {}
  if (!isObjectSchema(schema)) return parseSchema(schema, values[0], values[0])

  const shape = objectShape(schema)
  const input: Dict = {}
  Object.keys(shape).forEach((key, index) => {
    if (values[index] !== undefined) input[key] = values[index]
  })
  return parseSchema(schema, input)
}

export function parseObject(schema: Schema | undefined, data: Dict = {}): unknown {
  return parseSchema(schema, data)
}

export function parseCommandOptions(
  definition: CommandDefinition,
  argv: string[],
  seed: Dict = {},
): { args: string[]; options: Dict; deprecations: DeprecationWarning[] } {
  const shape = objectShape(definition.options)
  const aliases = invert(definition.alias ?? {})
  const options: Dict = { ...seed }
  const args: string[] = []
  const deprecations: DeprecationWarning[] = []
  const noteDeprecated = (key: string, flag: string) => {
    if (isDeprecated(shape[key])) deprecations.push({ flag, option: key })
  }

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!

    if (token === '--') {
      args.push(...argv.slice(index + 1))
      break
    }

    if (token.startsWith('--no-')) {
      const key = matchKey(shape, camel(token.slice(5)))
      options[key] = false
      noteDeprecated(key, token)
      continue
    }

    if (token.startsWith('--')) {
      const [rawKey, equalsValue] = token.slice(2).split(/=(.*)/s)
      const key = matchKey(shape, camel(rawKey!))
      const isBoolean = isBooleanSchema(shape[key])
      options[key] = valueForOption(isBoolean, equalsValue, () => argv[++index]!)
      noteDeprecated(key, `--${rawKey}`)
      continue
    }

    if (/^-[A-Za-z]$/.test(token)) {
      const key = aliases[token.slice(1)] ?? token.slice(1)
      const isBoolean = isBooleanSchema(shape[key])
      options[key] = isBoolean ? true : argv[++index]
      noteDeprecated(key, token)
      continue
    }

    args.push(token)
  }

  return { args, options, deprecations }
}

function valueForOption(isBoolean: boolean, equalsValue: string | undefined, next: () => string): unknown {
  if (equalsValue !== undefined && equalsValue !== '') {
    if (isBoolean && equalsValue === 'true') return true
    if (isBoolean && equalsValue === 'false') return false
    return equalsValue
  }

  return isBoolean ? true : next()
}

function matchKey(shape: Dict<Schema>, key: string): string {
  return shape[key] ? key : Object.keys(shape).find((candidate) => camel(candidate) === key || kebab(candidate) === key) ?? key
}

function invert(input: Dict<string>): Dict<string> {
  const output: Dict<string> = {}
  for (const [key, value] of Object.entries(input)) output[value] = key
  return output
}

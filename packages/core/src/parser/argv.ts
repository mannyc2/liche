import type { CommandRuntime, Dict, Schema } from '../types.js'
import { camel, kebab } from '../internal.js'
import { ParseError } from '../errors/error.js'
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
  definition: CommandRuntime,
  argv: string[],
  seed: Dict = {},
): { args: string[]; options: Dict; explicitOptions: Set<string>; deprecations: DeprecationWarning[] } {
  const shape = objectShape(definition.options)
  const aliases = invert(definition.alias ?? {})
  const options: Dict = { ...seed }
  const explicitOptions = new Set(Object.keys(seed))
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
      assertKnownOption(shape, key, token)
      options[key] = false
      explicitOptions.add(key)
      noteDeprecated(key, token)
      continue
    }

    if (token.startsWith('--')) {
      const [rawKey, equalsValue] = token.slice(2).split(/=(.*)/s)
      const key = matchKey(shape, camel(rawKey!))
      assertKnownOption(shape, key, `--${rawKey}`)
      const isBoolean = isBooleanSchema(shape[key])
      options[key] = valueForOption(isBoolean, equalsValue, () => argv[++index]!)
      explicitOptions.add(key)
      noteDeprecated(key, `--${rawKey}`)
      continue
    }

    if (/^-[A-Za-z]$/.test(token)) {
      const key = aliases[token.slice(1)] ?? token.slice(1)
      assertKnownOption(shape, key, token)
      const isBoolean = isBooleanSchema(shape[key])
      options[key] = isBoolean ? true : argv[++index]
      explicitOptions.add(key)
      noteDeprecated(key, token)
      continue
    }

    args.push(token)
  }

  return { args, options, explicitOptions, deprecations }
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

function assertKnownOption(shape: Dict<Schema>, key: string, flag: string): void {
  if (!shape[key]) throw new ParseError({ message: `Unknown option: ${flag}` })
}

function invert(input: Dict<string>): Dict<string> {
  const output: Dict<string> = {}
  for (const [key, value] of Object.entries(input)) output[value] = key
  return output
}

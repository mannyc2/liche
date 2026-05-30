import type { CommandRuntime, Dict, FieldErrorSource, Schema } from '../types.js'
import { camel } from '../internal.js'
import { ParseError } from '../errors/error.js'
import {
  isBooleanSchema,
  isDeprecated,
  isObjectSchema,
  objectShape,
  parseSchema,
  parseSchemaAsync,
} from '../schema/zod.js'
import { flagValue, splitFlag } from './flags.js'

export type DeprecationWarning = { flag: string; option: string }

export function parseObject(schema: Schema | undefined, data: Dict = {}): unknown {
  return parseSchema(schema, data)
}

// Positionals bind to one of three arg shapes: none, a single bare schema
// (`arg.int()`), or an object whose keys define order. Extra positionals are an
// error in every case — a strict, structured failure lets a caller (especially
// an LLM agent) correct in one step instead of silently getting wrong input.
// The return is genuinely `unknown`: a bare schema yields a scalar, an object a
// Dict, so there is no single narrower type to honestly assert.
export async function parseArgsAsync(schema: Schema | undefined, values: string[]): Promise<unknown> {
  if (!schema) {
    if (values.length > 0) throw tooManyPositionals(0, [], values)
    return {}
  }
  if (!isObjectSchema(schema)) {
    if (values.length > 1) throw tooManyPositionals(1, [], values)
    return parseSchemaAsync(schema, values[0])
  }
  const keys = Object.keys(objectShape(schema))
  if (values.length > keys.length) throw tooManyPositionals(keys.length, keys, values)
  const input: Dict = {}
  keys.forEach((key, index) => {
    if (values[index] !== undefined) input[key] = values[index]
  })
  return parseSchemaAsync(schema, input)
}

function tooManyPositionals(expected: number, keys: string[], received: string[]): ParseError {
  const got = `received ${received.length}: ${received.join(' ')}`
  if (expected === 0) return new ParseError({ message: `This command takes no positional arguments, but ${got}` })
  const names = keys.length ? ` (${keys.join(', ')})` : ''
  return new ParseError({ message: `Too many positional arguments: expected ${expected}${names}, ${got}` })
}

export async function parseObjectAsync(schema: Schema | undefined, data: Dict = {}): Promise<unknown> {
  return parseSchemaAsync(schema, data)
}

export function parseCommandOptions(
  definition: CommandRuntime,
  argv: string[],
  seed: Dict = {},
): {
  args: string[]
  options: Dict
  explicitOptions: Set<string>
  deprecations: DeprecationWarning[]
  optionSources: Map<string, FieldErrorSource>
} {
  const shape = objectShape(definition.options)
  const aliases = invert(definition.alias ?? {})
  const options: Dict = { ...seed }
  const explicitOptions = new Set(Object.keys(seed))
  const args: string[] = []
  const deprecations: DeprecationWarning[] = []
  const optionSources = new Map<string, FieldErrorSource>()
  // Records a resolved option: its value, that it was set explicitly, its argv
  // source (for error attribution), and any deprecation. Centralized so every
  // flag branch stays consistent — a new branch can't forget the source/deprecation.
  const record = (key: string, flag: string, value: unknown) => {
    options[key] = value
    explicitOptions.add(key)
    optionSources.set(key, { kind: 'argv', flag })
    if (isDeprecated(shape[key])) deprecations.push({ flag, option: key })
  }

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!

    if (token === '--') {
      args.push(...argv.slice(index + 1))
      break
    }

    if (token.startsWith('--no-')) {
      const key = resolveOption(shape, camel(token.slice(5)), token)
      record(key, token, false)
      continue
    }

    if (token.startsWith('--')) {
      const { name: rawKey, equalsValue } = splitFlag(token.slice(2))
      const flag = `--${rawKey}`
      const key = resolveOption(shape, camel(rawKey), flag)
      record(
        key,
        flag,
        flagValue(!isBooleanSchema(shape[key]), equalsValue, () => argv[++index]),
      )
      continue
    }

    if (/^-[A-Za-z]$/.test(token)) {
      const key = resolveOption(shape, aliases[token.slice(1)] ?? token.slice(1), token)
      record(key, token, isBooleanSchema(shape[key]) ? true : argv[++index])
      continue
    }

    args.push(token)
  }

  return { args, options, explicitOptions, deprecations, optionSources }
}

// Resolve an option token to a known schema key, or throw. `candidate` is the
// post-prefix name (camelCased for long flags, alias-mapped for short ones); a
// schema author may declare a non-camel key, so we also match by camel-equality.
// Returns only a valid key — there is no "unresolved key" value threaded onward.
function resolveOption(shape: Dict<Schema>, candidate: string, flag: string): string {
  const key = shape[candidate] ? candidate : Object.keys(shape).find((name) => camel(name) === candidate)
  if (!key) throw new ParseError({ message: `Unknown option: ${flag}` })
  return key
}

function invert(input: Dict<string>): Dict<string> {
  const output: Dict<string> = {}
  for (const [key, value] of Object.entries(input)) output[value] = key
  return output
}

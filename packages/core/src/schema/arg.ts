import { z } from 'zod'
import type { Schema } from '../types.js'

export type StoredCodecSurface = 'all' | 'cli' | 'fetch' | { kind: 'extension'; transport: string }

export type CodecKind =
  | 'arg.boolean'
  | 'arg.fromString'
  | 'arg.int'
  | 'arg.number'
  | 'arg.port'
  | 'arg.positiveInt'

export type RuntimeArgMeta = {
  codecKind: CodecKind
  runtimeOnly?: boolean
  surface?: StoredCodecSurface
}

const runtimeArgMeta = z.registry<RuntimeArgMeta>()

const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/
const INT_RE = /^-?(0|[1-9][0-9]*)$/
const POS_INT_RE = /^[1-9][0-9]*$/

function number() {
  const input = z.union([z.string().regex(NUMBER_RE), z.number().finite()])
  const output = z.number().finite()
  const schema = z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
  return schema.register(runtimeArgMeta, { codecKind: 'arg.number' })
}

function int() {
  const input = z.union([z.string().regex(INT_RE), z.number().int().safe()])
  const output = z.number().int().safe()
  const schema = z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
  return schema.register(runtimeArgMeta, { codecKind: 'arg.int' })
}

function positiveInt() {
  const input = z.union([z.string().regex(POS_INT_RE), z.number().int().positive().safe()])
  const output = z.number().int().positive().safe()
  const schema = z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
  return schema.register(runtimeArgMeta, { codecKind: 'arg.positiveInt' })
}

function port() {
  const input = z.union([z.string().regex(POS_INT_RE), z.number().int().min(1).max(65535)])
  const output = z.number().int().min(1).max(65535)
  const schema = z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
  return schema.register(runtimeArgMeta, { codecKind: 'arg.port' })
}

function boolean() {
  const input = z.union([
    z.literal('true'),
    z.literal('false'),
    z.literal('1'),
    z.literal('0'),
    z.boolean(),
  ])
  const output = z.boolean()
  const schema = z.codec(input, output, {
    decode: (value) => (typeof value === 'boolean' ? value : value === 'true' || value === '1'),
    encode: (value) => (value ? 'true' : 'false'),
  })
  return schema.register(runtimeArgMeta, { codecKind: 'arg.boolean' })
}

/**
 * Issue shape that can be appended to `ArgDecodeContext.issues` to surface a
 * structured validation failure from an `arg.fromString` decoder. Append the
 * issue and return `z.NEVER` to abort decoding; `parseSchemaAsync` then
 * normalizes the result through `ValidationError`.
 */
export type ArgIssue = {
  code?: string
  message: string
  path?: ReadonlyArray<string | number>
  input?: unknown
}

/**
 * Context passed to an `arg.fromString` decoder. `issues` is mutable: pushing
 * an entry signals a validation failure. Arbitrary thrown errors from the
 * decoder are operational failures, not normalized validation errors.
 */
export type ArgDecodeContext<I = unknown> = {
  value: I
  issues: ArgIssue[]
}

type FromStringOptions<I, O> = {
  input?: z.ZodType<I, any>
  output: z.ZodType<O, any>
  surface?: StoredCodecSurface
  decode: (raw: I, ctx: ArgDecodeContext<I>) => O | Promise<O>
  encode?: (value: O) => I
}

function throwingEncoder(): never {
  throw new Error('arg.fromString codec is runtime-only and has no encoder')
}

function fromString<I, O>(options: FromStringOptions<I, O>) {
  const inputSchema = (options.input ?? z.string()) as z.ZodType<I, any>
  const encode = (options.encode ?? (throwingEncoder as (value: O) => I)) as (value: O) => I
  const surface: StoredCodecSurface = options.surface ?? 'cli'
  const schema = z.codec(inputSchema, options.output, {
    decode: options.decode as (raw: I, ctx: unknown) => O | Promise<O>,
    encode,
  })
  return schema.register(runtimeArgMeta, {
    codecKind: 'arg.fromString',
    runtimeOnly: options.encode === undefined,
    surface,
  })
}

export const arg = { boolean, fromString, int, number, port, positiveInt }

const WRAPPER_KINDS = new Set(['optional', 'default', 'nullable', 'catch', 'readonly'])

export function getRuntimeArgMeta(schema: Schema | undefined): RuntimeArgMeta | undefined {
  let current: any = schema
  while (current) {
    const entry = runtimeArgMeta.get(current)
    if (entry) return entry
    if (!WRAPPER_KINDS.has(current?.def?.type ?? '')) return undefined
    const inner = current.def?.innerType
    if (!inner || inner === current) return undefined
    current = inner
  }
  return undefined
}

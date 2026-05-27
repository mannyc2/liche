import { z } from 'zod'
import type { Dict, FieldError, FieldErrorSource, Schema } from '../types.js'
import { ValidationError } from '../errors/error.js'

export { z }

const PARSE_PARAMS = { reportInput: true } as const

export function parseSchema<T>(schema: Schema<T> | undefined, input: unknown, fallback: unknown = {}): T | Dict {
  if (!schema) return fallback as Dict
  try {
    const decoder = (schema as any).decode
    return typeof decoder === 'function'
      ? decoder.call(schema, input, PARSE_PARAMS)
      : schema.parse(input, PARSE_PARAMS)
  } catch (error) {
    throw normalizeZodError(error)
  }
}

export async function parseSchemaAsync<T>(
  schema: Schema<T> | undefined,
  input: unknown,
  fallback: unknown = {},
): Promise<T | Dict> {
  if (!schema) return fallback as Dict
  try {
    if (typeof (schema as any).decodeAsync === 'function') {
      return await (schema as any).decodeAsync(input, PARSE_PARAMS)
    }
    return await (schema as any).parseAsync(input, PARSE_PARAMS)
  } catch (error) {
    throw normalizeZodError(error)
  }
}

export function toJsonSchema(schema: Schema | undefined): unknown {
  if (!schema) return undefined
  if (typeof (z as any).toJSONSchema === 'function') return (z as any).toJSONSchema(schema, { io: 'input' })
  return undefined
}

export function encodeDefault(schema: Schema | undefined): string | undefined {
  if (!schema) return undefined
  const def = (schema as any)?.def?.defaultValue
  if (def === undefined) return undefined
  const value = typeof def === 'function' ? safeCall(def) : def
  if (value === undefined) return undefined
  try {
    const inner = (schema as any).def?.innerType ?? schema
    const encoder = (inner as any).encode
    const encoded = typeof encoder === 'function' ? encoder.call(inner, value) : value
    return typeof encoded === 'string' ? encoded : JSON.stringify(encoded)
  } catch {
    return undefined
  }
}

function safeCall(fn: () => unknown): unknown {
  try { return fn() } catch { return undefined }
}

export function objectShape(schema: Schema | undefined): Dict<Schema> {
  if (!schema) return {}
  if (schema instanceof z.ZodObject) return schema.shape as Dict<Schema>
  return {}
}

export function isObjectSchema(schema: Schema | undefined): boolean {
  return schema instanceof z.ZodObject
}

export function isBooleanSchema(schema: Schema | undefined): boolean {
  const inner = unwrap(schema)
  if (kind(inner) === 'boolean') return true
  if (kind(inner) === 'pipe') {
    const out = (inner as any)?.def?.out
    return kind(unwrap(out)) === 'boolean'
  }
  return false
}

export function primitiveKind(schema: Schema | undefined): string | undefined {
  const value = kind(unwrap(schema))
  return value === 'boolean' || value === 'number' || value === 'string' ? value : undefined
}

export function description(schema: Schema | undefined): string | undefined {
  return (schema as any)?.description
}

export function meta(schema: Schema | undefined): Dict | undefined {
  let current: any = schema
  while (current) {
    const reader = current.meta
    if (typeof reader === 'function') {
      try {
        const value = reader.call(current)
        if (value && typeof value === 'object') return value as Dict
      } catch { /* fall through to inner unwrap */ }
    }
    const inner = unwrapOnce(current)
    if (!inner || inner === current) return undefined
    current = inner
  }
  return undefined
}

function unwrapOnce(schema: any): any {
  if (!schema) return undefined
  if (schema.def?.innerType) return schema.def.innerType
  if (typeof schema.unwrap === 'function') {
    try { return schema.unwrap() } catch { return undefined }
  }
  return undefined
}

export function isDeprecated(schema: Schema | undefined): boolean {
  return !!meta(schema)?.['deprecated']
}

export function deprecatedKeys(schema: Schema | undefined): string[] {
  const shape = objectShape(schema)
  return Object.entries(shape)
    .filter(([, value]) => isDeprecated(value))
    .map(([key]) => key)
}

export function isOptional(schema: Schema | undefined): boolean {
  if (!schema) return true
  return schema.isOptional()
}

export function kind(schema: Schema | undefined): string | undefined {
  return (schema as any)?.type
}

const WRAPPER_KINDS = ['optional', 'default', 'nullable', 'catch', 'readonly']

function unwrap(schema: Schema | undefined): Schema | undefined {
  let current: any = schema
  while (current && WRAPPER_KINDS.includes(kind(current) ?? '')) {
    const inner = unwrapOnce(current)
    if (!inner || inner === current) return current
    current = inner
  }
  return current
}

function normalizeZodError(error: unknown) {
  if (error instanceof z.ZodError) {
    return new ValidationError({
      message: 'Validation failed',
      fieldErrors: error.issues.map((issue) => {
        const received = receivedFromIssue(issue)
        const missing = issue.code === 'invalid_type' && received === 'undefined'
        return {
          path: issue.path.length ? `$.${issue.path.join('.')}` : '$',
          message: issue.message,
          ...(issue.code ? { code: issue.code } : undefined),
          ...(missing ? { missing: true } : undefined),
          ...((issue as any).expected ? { expected: String((issue as any).expected) } : undefined),
          ...(received !== undefined ? { received } : undefined),
        }
      }),
    })
  }
  return error
}

function receivedFromIssue(issue: { code?: string }): string | undefined {
  if (issue.code !== 'invalid_type') return undefined
  // Prefer any structured `received` Zod may attach (custom codec issues, future Zod versions).
  const structured = (issue as { received?: unknown }).received
  if (typeof structured === 'string') return structured
  if (!('input' in issue)) return 'undefined'
  return typeofName((issue as { input: unknown }).input)
}

function typeofName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
  }
  return typeof value
}

export function attachFieldSources(
  error: unknown,
  sourcesByTopLevelKey: Record<string, FieldErrorSource>,
): unknown {
  if (!(error instanceof ValidationError)) return error
  const rewritten: FieldError[] = error.fieldErrors.map((fe) => {
    if (fe.source !== undefined) return fe
    const key = topLevelKey(fe.path)
    const source = key !== undefined ? sourcesByTopLevelKey[key] : undefined
    return source ? { ...fe, source } : fe
  })
  return new ValidationError({
    message: error.shortMessage,
    cause: error.cause instanceof Error ? error.cause : undefined,
    fieldErrors: rewritten,
  })
}

function topLevelKey(path: string): string | undefined {
  if (path === '$') return ''
  if (!path.startsWith('$.')) return undefined
  const rest = path.slice(2)
  const dot = rest.indexOf('.')
  return dot === -1 ? rest : rest.slice(0, dot)
}

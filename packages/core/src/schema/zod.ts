import { z } from 'zod'
import type { Dict, Schema } from '../types.js'
import { ValidationError } from '../errors/error.js'

export { z }

export function parseSchema<T>(schema: Schema<T> | undefined, input: unknown, fallback: unknown = {}): T | Dict {
  if (!schema) return fallback as Dict
  try {
    const decoder = (schema as any).decode
    return typeof decoder === 'function' ? decoder.call(schema, input) : schema.parse(input)
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
  return kind(unwrap(schema)) === 'boolean'
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
        const received = parseReceived(issue.message)
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

function parseReceived(message: string): string | undefined {
  const match = /received (\w+)/.exec(message)
  return match?.[1]
}

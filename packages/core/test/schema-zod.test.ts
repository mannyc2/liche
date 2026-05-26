import { describe, expect, test } from 'bun:test'
import {
  deprecatedKeys,
  description,
  encodeDefault,
  isBooleanSchema,
  isDeprecated,
  isObjectSchema,
  isOptional,
  kind,
  meta,
  objectShape,
  parseSchema,
  parseSchemaAsync,
  toJsonSchema,
  z,
} from '../src/schema/zod.js'
import { ValidationError } from '../src/errors/error.js'

describe('parseSchema', () => {
  test('returns parsed value on success', () => {
    const out = parseSchema(z.object({ a: z.string() }), { a: 'hi' })
    expect(out).toEqual({ a: 'hi' })
  })

  test('returns fallback when schema is undefined', () => {
    expect(parseSchema(undefined, { a: 1 })).toEqual({})
    expect(parseSchema(undefined, { a: 1 }, 'custom')).toBe('custom' as any)
  })

  test('flags missing=true only when invalid_type AND received=undefined', () => {
    try {
      parseSchema(z.object({ a: z.string() }), {})
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.missing).toBe(true)
      expect(fe.path).toBe('$.a')
      expect(fe.code).toBe('invalid_type')
    }
  })

  test('does NOT flag missing when received is not undefined (wrong-type case)', () => {
    try {
      parseSchema(z.object({ a: z.number() }), { a: 'x' })
      throw new Error('should have thrown')
    } catch (error) {
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.missing).toBeUndefined()
      expect(fe.received).toBe('string')
    }
  })

  test('preserves "expected" type tag on fieldError when present', () => {
    try {
      parseSchema(z.object({ a: z.string() }), { a: 42 })
      throw new Error('should have thrown')
    } catch (error) {
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.expected).toBe('string')
    }
  })

  test('omits "expected" on fieldError when Zod issue has no expected', () => {
    try {
      parseSchema(z.string().refine(() => false, 'custom'), 'x')
      throw new Error('should have thrown')
    } catch (error) {
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.expected).toBeUndefined()
    }
  })

  test('parses received from issue message verbatim (multi-char word)', () => {
    try {
      parseSchema(z.object({ a: z.string() }), { a: true })
      throw new Error('should have thrown')
    } catch (error) {
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.received).toBe('boolean')
    }
  })

  test('top-level invalid path is "$" not "$."', () => {
    try {
      parseSchema(z.string(), 42)
      throw new Error('should have thrown')
    } catch (error) {
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.path).toBe('$')
    }
  })

  test('uses decoder when schema exposes one', () => {
    const schema = z.string()
    ;(schema as any).decode = (input: unknown) => `decoded:${String(input)}`
    expect(parseSchema(schema, 'x' as any)).toBe('decoded:x' as any)
  })
})

describe('parseSchemaAsync', () => {
  test('returns fallback when schema is undefined', async () => {
    expect(await parseSchemaAsync(undefined, { a: 1 })).toEqual({})
    expect(await parseSchemaAsync(undefined, { a: 1 }, 'custom')).toBe('custom' as any)
  })

  test('passes sync schemas through unchanged', async () => {
    const schema = z.object({ a: z.string() })
    expect(await parseSchemaAsync(schema, { a: 'hi' })).toEqual({ a: 'hi' })
  })

  test('resolves an async transform', async () => {
    const schema = z.string().transform(async (s) => `async:${s}`)
    expect(await parseSchemaAsync(schema, 'x')).toBe('async:x' as any)
  })

  test('resolves a codec with async decode', async () => {
    const schema = z.codec(z.string(), z.number(), {
      decode: async (s) => Number(s),
      encode: (n) => String(n),
    })
    expect(await parseSchemaAsync(schema, '42')).toBe(42 as any)
  })

  test('normalizes async validation errors into ValidationError', async () => {
    const schema = z.object({ a: z.string() })
    try {
      await parseSchemaAsync(schema, { a: 42 })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.path).toBe('$.a')
      expect(fe.code).toBe('invalid_type')
      expect(fe.expected).toBe('string')
      expect(fe.received).toBe('number')
    }
  })

  test('async refinement failures normalize too', async () => {
    const schema = z.string().refine(async () => false, 'custom-async')
    try {
      await parseSchemaAsync(schema, 'x')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const fe = (error as ValidationError).fieldErrors[0]!
      expect(fe.path).toBe('$')
      expect(fe.message).toBe('custom-async')
    }
  })
})

describe('toJsonSchema', () => {
  test('returns undefined when schema is undefined', () => {
    expect(toJsonSchema(undefined)).toBeUndefined()
  })

  test('returns a JSON Schema for a Zod schema', () => {
    const out = toJsonSchema(z.object({ a: z.string() })) as any
    expect(out).toBeDefined()
    expect(out.type).toBe('object')
    expect(out.properties.a.type).toBe('string')
  })
})

describe('encodeDefault', () => {
  test('returns undefined when schema has no default', () => {
    expect(encodeDefault(z.string())).toBeUndefined()
    expect(encodeDefault(undefined)).toBeUndefined()
  })

  test('encodes string default as itself', () => {
    expect(encodeDefault(z.string().default('hi'))).toBe('hi')
  })

  test('encodes number default via JSON', () => {
    expect(encodeDefault(z.number().default(7))).toBe('7')
  })

  test('encodes boolean default via JSON', () => {
    expect(encodeDefault(z.boolean().default(false))).toBe('false')
  })

  test('encodes object default via JSON', () => {
    expect(encodeDefault(z.object({ a: z.string() }).default({ a: 'x' }))).toBe('{"a":"x"}')
  })

  test('returns undefined when default is a function returning undefined', () => {
    const schema = z.string().default(() => undefined as unknown as string)
    expect(encodeDefault(schema)).toBeUndefined()
  })

  test('encodes function-returned default value', () => {
    const schema = z.string().default(() => 'computed')
    expect(encodeDefault(schema)).toBe('computed')
  })
})

describe('toJsonSchema — input vs output mode', () => {
  test('uses input mode (which keeps the optional marker rather than baking it into the default)', () => {
    const schema = z.object({ a: z.string().optional() })
    const out = toJsonSchema(schema) as any
    expect(out.type).toBe('object')
    expect(out.properties.a).toBeDefined()
    expect(out.required ?? []).not.toContain('a')
  })

  test('produces a schema for a default-wrapped boolean', () => {
    const out = toJsonSchema(z.object({ flag: z.boolean().default(false) })) as any
    expect(out.properties.flag).toBeDefined()
  })
})

describe('objectShape / isObjectSchema', () => {
  test('returns the shape for ZodObject', () => {
    const shape = objectShape(z.object({ a: z.string(), b: z.number() }))
    expect(Object.keys(shape)).toEqual(['a', 'b'])
  })

  test('returns {} for non-object schemas and undefined', () => {
    expect(objectShape(z.string())).toEqual({})
    expect(objectShape(undefined)).toEqual({})
  })

  test('isObjectSchema distinguishes objects from scalars', () => {
    expect(isObjectSchema(z.object({}))).toBe(true)
    expect(isObjectSchema(z.string())).toBe(false)
    expect(isObjectSchema(undefined)).toBe(false)
  })
})

describe('isBooleanSchema', () => {
  test('detects plain boolean', () => {
    expect(isBooleanSchema(z.boolean())).toBe(true)
  })

  test.each([
    ['optional', () => z.boolean().optional()],
    ['default', () => z.boolean().default(false)],
    ['nullable', () => z.boolean().nullable()],
    ['catch', () => z.boolean().catch(false)],
    ['readonly', () => z.boolean().readonly()],
    ['optional + default', () => z.boolean().optional().default(false)],
    ['nullable + readonly', () => z.boolean().nullable().readonly()],
  ])('detects boolean through %s wrapper', (_label, build) => {
    expect(isBooleanSchema(build())).toBe(true)
  })

  test.each([
    ['plain string', () => z.string()],
    ['optional string', () => z.string().optional()],
    ['undefined', () => undefined],
  ])('returns false for %s', (_label, build) => {
    expect(isBooleanSchema(build())).toBe(false)
  })
})

describe('description / kind / isOptional', () => {
  test('description returns the .describe() value', () => {
    expect(description(z.string().describe('a name'))).toBe('a name')
    expect(description(z.string())).toBeUndefined()
    expect(description(undefined)).toBeUndefined()
  })

  test('kind returns the schema type tag', () => {
    expect(kind(z.string())).toBe('string')
    expect(kind(z.boolean())).toBe('boolean')
    expect(kind(z.object({}))).toBe('object')
  })

  test('isOptional is true for undefined schema', () => {
    expect(isOptional(undefined)).toBe(true)
  })

  test('isOptional reflects schema.isOptional()', () => {
    expect(isOptional(z.string().optional())).toBe(true)
    expect(isOptional(z.string())).toBe(false)
  })
})

describe('meta / isDeprecated / deprecatedKeys', () => {
  test('meta returns the metadata object', () => {
    const schema = z.string().meta({ category: 'ui' })
    expect(meta(schema)).toEqual({ category: 'ui' })
  })

  test('meta unwraps through .optional() and .default()', () => {
    const schema = z.string().meta({ deprecated: true }).optional().default('x')
    expect(meta(schema)).toEqual({ deprecated: true })
  })

  test('meta returns undefined when no metadata is set', () => {
    expect(meta(z.string())).toBeUndefined()
    expect(meta(undefined)).toBeUndefined()
  })

  test('isDeprecated reads deprecated through wrappers', () => {
    expect(isDeprecated(z.boolean().meta({ deprecated: true }).default(false))).toBe(true)
    expect(isDeprecated(z.boolean().default(false))).toBe(false)
    expect(isDeprecated(undefined)).toBe(false)
  })

  test('deprecatedKeys returns only the deprecated property names', () => {
    const schema = z.object({
      keep: z.string(),
      drop: z.string().meta({ deprecated: true }),
      legacy: z.boolean().meta({ deprecated: true }).default(false),
    })
    expect(deprecatedKeys(schema)).toEqual(['drop', 'legacy'])
  })

  test('deprecatedKeys returns [] for non-object schemas', () => {
    expect(deprecatedKeys(z.string())).toEqual([])
    expect(deprecatedKeys(undefined)).toEqual([])
  })
})

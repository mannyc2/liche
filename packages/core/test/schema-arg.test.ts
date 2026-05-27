import { describe, expect, test } from 'bun:test'
import { arg, getRuntimeArgMeta } from '../src/schema/arg.js'
import { encodeDefault, isBooleanSchema, parseSchema, parseSchemaAsync, toJsonSchema, z } from '../src/schema/zod.js'
import { ValidationError } from '../src/errors/error.js'

function expectReject(schema: any, input: unknown): ValidationError {
  try {
    parseSchema(schema, input)
    throw new Error(`expected ValidationError for input ${JSON.stringify(input)}`)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    return error
  }
}

describe('arg.number', () => {
  test.each([
    ['"3"', '3', 3],
    ['"-3"', '-3', -3],
    ['"0"', '0', 0],
    ['"3.14"', '3.14', 3.14],
    ['number 3', 3, 3],
    ['number 3.14', 3.14, 3.14],
    ['number -3.14', -3.14, -3.14],
    ['number 0', 0, 0],
  ])('accepts %s', (_label, input, expected) => {
    expect(parseSchema(arg.number(), input)).toBe(expected)
  })

  test.each([
    ['"+3"', '+3'],
    ['"03"', '03'],
    ['"3."', '3.'],
    ['".3"', '.3'],
    ['"1e3"', '1e3'],
    ['"Infinity"', 'Infinity'],
    ['"NaN"', 'NaN'],
    ['""', ''],
    ['"   "', '   '],
    ['"3 "', '3 '],
    ['true', true],
    ['null', null],
    ['array', []],
    ['object', {}],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, input) => {
    expectReject(arg.number(), input)
  })
})

describe('arg.int', () => {
  test.each([
    ['"3"', '3', 3],
    ['"-3"', '-3', -3],
    ['"0"', '0', 0],
    ['number 3', 3, 3],
    ['number -3', -3, -3],
    ['number 0', 0, 0],
  ])('accepts %s', (_label, input, expected) => {
    expect(parseSchema(arg.int(), input)).toBe(expected)
  })

  test.each([
    ['"3.1"', '3.1'],
    ['"1e3"', '1e3'],
    ['"+3"', '+3'],
    ['"03"', '03'],
    ['number 3.1', 3.1],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['true', true],
    ['null', null],
    ['""', ''],
  ])('rejects %s', (_label, input) => {
    expectReject(arg.int(), input)
  })

  test('rejects unsafe integer string', () => {
    expectReject(arg.int(), String(Number.MAX_SAFE_INTEGER + 1))
  })
})

describe('arg.positiveInt', () => {
  test.each([
    ['"1"', '1', 1],
    ['"42"', '42', 42],
    ['number 1', 1, 1],
    ['number 42', 42, 42],
  ])('accepts %s', (_label, input, expected) => {
    expect(parseSchema(arg.positiveInt(), input)).toBe(expected)
  })

  test.each([
    ['"0"', '0'],
    ['"-1"', '-1'],
    ['number 0', 0],
    ['number -1', -1],
    ['"3.1"', '3.1'],
  ])('rejects %s', (_label, input) => {
    expectReject(arg.positiveInt(), input)
  })
})

describe('arg.port', () => {
  test.each([
    ['"1"', '1', 1],
    ['"65535"', '65535', 65535],
    ['"3000"', '3000', 3000],
    ['number 1', 1, 1],
    ['number 65535', 65535, 65535],
  ])('accepts %s', (_label, input, expected) => {
    expect(parseSchema(arg.port(), input)).toBe(expected)
  })

  test.each([
    ['"0"', '0'],
    ['"65536"', '65536'],
    ['number 0', 0],
    ['number 65536', 65536],
    ['"-1"', '-1'],
  ])('rejects %s', (_label, input) => {
    expectReject(arg.port(), input)
  })
})

describe('arg.boolean', () => {
  test.each([
    ['"true"', 'true', true],
    ['"false"', 'false', false],
    ['"1"', '1', true],
    ['"0"', '0', false],
    ['bool true', true, true],
    ['bool false', false, false],
  ])('accepts %s', (_label, input, expected) => {
    expect(parseSchema(arg.boolean(), input)).toBe(expected)
  })

  test.each([
    ['"TRUE"', 'TRUE'],
    ['"True"', 'True'],
    ['"yes"', 'yes'],
    ['"no"', 'no'],
    ['""', ''],
    ['"hello"', 'hello'],
    ['number 1', 1],
    ['number 0', 0],
    ['null', null],
    ['array', []],
    ['object', {}],
  ])('rejects %s', (_label, input) => {
    expectReject(arg.boolean(), input)
  })
})

describe('arg wrapper composition', () => {
  test('arg.positiveInt().optional() accepts undefined', () => {
    expect(parseSchema(arg.positiveInt().optional(), undefined)).toBeUndefined()
  })

  test('arg.int().default(7) returns 7 for undefined', () => {
    expect(parseSchema(arg.int().default(7), undefined)).toBe(7)
  })

  test('encodeDefault renders int default as string', () => {
    expect(encodeDefault(arg.int().default(7))).toBe('7')
  })

  test('encodeDefault renders boolean default as string', () => {
    expect(encodeDefault(arg.boolean().default(false))).toBe('false')
  })

  test('isBooleanSchema recognizes arg.boolean() bare and wrapped', () => {
    expect(isBooleanSchema(arg.boolean())).toBe(true)
    expect(isBooleanSchema(arg.boolean().optional())).toBe(true)
    expect(isBooleanSchema(arg.boolean().default(false))).toBe(true)
  })

  test('isBooleanSchema does not flag non-boolean arg codecs', () => {
    expect(isBooleanSchema(arg.int())).toBe(false)
    expect(isBooleanSchema(arg.port())).toBe(false)
    expect(isBooleanSchema(arg.number())).toBe(false)
  })
})

describe('arg error shape', () => {
  test('bare schema produces $ path on rejection', () => {
    const err = expectReject(arg.positiveInt(), '0')
    expect(err.fieldErrors[0]!.path).toBe('$')
  })

  test('nested in object produces $.field path on rejection', () => {
    const err = expectReject(z.object({ replicas: arg.positiveInt() }), { replicas: '0' })
    expect(err.fieldErrors[0]!.path).toBe('$.replicas')
  })
})

describe('arg.fromString', () => {
  test('decodes a string to a custom runtime value via parseSchemaAsync', async () => {
    const codec = arg.fromString({
      input: z.url(),
      output: z.instanceof(URL),
      decode: async (s) => new URL(s),
    })
    const result = await parseSchemaAsync(codec, 'https://example.com/path')
    expect((result as URL).toString()).toBe('https://example.com/path')
  })

  test('input schema validation rejects before decode runs', async () => {
    let decodeRan = false
    const codec = arg.fromString({
      input: z.url(),
      output: z.instanceof(URL),
      decode: async (s) => {
        decodeRan = true
        return new URL(s)
      },
    })
    let caught: unknown
    try {
      await parseSchemaAsync(codec, 'not-a-url')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ValidationError)
    expect(decodeRan).toBe(false)
  })

  test('encodeDefault returns undefined for runtime-only fromString (no encoder)', () => {
    const codec = arg.fromString({
      output: z.string(),
      decode: async (s: string) => s.toUpperCase(),
    }).default('hello')
    expect(encodeDefault(codec)).toBeUndefined()
  })

  test('encodeDefault renders default when encoder is supplied', () => {
    const codec = arg.fromString({
      output: z.string(),
      decode: async (s: string) => s.toUpperCase(),
      encode: (value) => value.toLowerCase(),
    }).default('HELLO')
    expect(encodeDefault(codec)).toBe('hello')
  })

  test('registry metadata is read through .optional() and .default() wrappers', () => {
    expect(getRuntimeArgMeta(arg.port().optional())?.codecKind).toBe('arg.port')
    expect(getRuntimeArgMeta(arg.int().default(7))?.codecKind).toBe('arg.int')
    expect(getRuntimeArgMeta(arg.boolean().optional().default(true))?.codecKind).toBe('arg.boolean')
  })

  test('runtimeOnly is true when encoder is omitted, false when supplied', () => {
    expect(getRuntimeArgMeta(arg.fromString({ output: z.string(), decode: async (s) => s }))?.runtimeOnly).toBe(true)
    expect(getRuntimeArgMeta(arg.fromString({
      output: z.string(),
      decode: async (s) => s,
      encode: (v) => v,
    }))?.runtimeOnly).toBe(false)
  })

  test('default surface is cli when omitted', () => {
    expect(getRuntimeArgMeta(arg.fromString({ output: z.string(), decode: async (s) => s }))?.surface).toBe('cli')
  })

  test('explicit surface is preserved', () => {
    expect(getRuntimeArgMeta(arg.fromString({ output: z.string(), decode: async (s) => s, surface: 'all' }))?.surface).toBe('all')
    expect(getRuntimeArgMeta(arg.fromString({
      output: z.string(),
      decode: async (s) => s,
      surface: { kind: 'extension', transport: 'mcp' },
    }))?.surface).toEqual({ kind: 'extension', transport: 'mcp' })
  })

  test('registry keys do not leak into JSON Schema projection', () => {
    const projected = JSON.stringify(toJsonSchema(arg.fromString({
      input: z.string().meta({ valueLabel: 'file' }),
      output: z.instanceof(URL),
      decode: async (s) => new URL(s),
      surface: 'cli',
    })))
    expect(projected).not.toContain('codecKind')
    expect(projected).not.toContain('runtimeOnly')
    expect(projected).not.toContain('"surface"')
  })

  test('JSON Schema projection preserves input meta and reflects the input shape', () => {
    const projected = toJsonSchema(z.object({
      file: arg.fromString({
        input: z.string().meta({ valueLabel: 'file' }),
        output: z.instanceof(URL),
        decode: async (s) => new URL(s),
      }),
    })) as any
    const file = projected.properties.file
    expect(file.type).toBe('string')
    expect(file.valueLabel).toBe('file')
  })
})

describe('arg JSON Schema projection', () => {
  test('arg.positiveInt projects string-with-pattern OR positive safe integer', () => {
    const schema: any = toJsonSchema(z.object({ replicas: arg.positiveInt() }))
    const replicas = schema.properties.replicas
    expect(replicas.anyOf).toBeDefined()
    const stringBranch = replicas.anyOf.find((b: any) => b.type === 'string')
    const intBranch = replicas.anyOf.find((b: any) => b.type === 'integer')
    expect(stringBranch.pattern).toBe('^[1-9][0-9]*$')
    expect(intBranch.exclusiveMinimum).toBe(0)
    expect(intBranch.maximum).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('arg.port projects string-with-pattern OR integer 1..65535', () => {
    const schema: any = toJsonSchema(z.object({ port: arg.port() }))
    const port = schema.properties.port
    const stringBranch = port.anyOf.find((b: any) => b.type === 'string')
    const intBranch = port.anyOf.find((b: any) => b.type === 'integer')
    expect(stringBranch.pattern).toBe('^[1-9][0-9]*$')
    expect(intBranch.minimum).toBe(1)
    expect(intBranch.maximum).toBe(65535)
  })

  test('arg.boolean projects the four string literals OR a boolean', () => {
    const schema: any = toJsonSchema(z.object({ debug: arg.boolean() }))
    const debug = schema.properties.debug
    const constants = debug.anyOf
      .filter((b: any) => b.type === 'string')
      .map((b: any) => b.const)
      .sort()
    expect(constants).toEqual(['0', '1', 'false', 'true'])
    expect(debug.anyOf.some((b: any) => b.type === 'boolean')).toBe(true)
  })
})

import { describe, expect, test } from 'bun:test'
import { arg } from '../src/schema/arg.js'
import { encodeDefault, isBooleanSchema, parseSchema, toJsonSchema, z } from '../src/schema/zod.js'
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

import { describe, expect, test } from 'bun:test'
import { arg } from '../src/schema/arg.js'
import { checkCommandSurface, type CommandSurface } from '../src/schema/surface.js'
import { z } from '../src/schema/zod.js'
import type { Entry } from '../src/types.js'

function commandEntry(runtime: { args?: any; options?: any; env?: any }): Entry {
  return { _command: true, contract: { name: 'x' }, runtime }
}

const FETCH: CommandSurface = 'fetch'
const CLI: CommandSurface = 'cli'
const MCP: CommandSurface = { kind: 'extension', transport: 'mcp' }
const SKILLS: CommandSurface = { kind: 'extension', transport: 'skills' }

const cliOnlyCodec = () =>
  arg.fromString<string, string>({ output: z.string(), decode: async (s) => s, surface: 'cli' })
const allCodec = () => arg.fromString<string, string>({ output: z.string(), decode: async (s) => s, surface: 'all' })
const mcpOnlyCodec = () => arg.fromString<string, string>({ output: z.string(), decode: async (s) => s, surface: MCP })

describe('checkCommandSurface', () => {
  test('returns ok for a command with no codec fields', () => {
    const entry = commandEntry({ options: z.object({ name: z.string() }) })
    for (const surface of [CLI, FETCH, MCP, SKILLS]) {
      expect(checkCommandSurface(entry, surface)).toEqual({ ok: true })
    }
  })

  test('CLI-only codec in options rejects fetch and mcp, accepts cli', () => {
    const entry = commandEntry({ options: z.object({ file: cliOnlyCodec() }) })
    expect(checkCommandSurface(entry, CLI)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, FETCH)).toEqual({
      ok: false,
      field: 'file',
      codecKind: 'arg.fromString',
      surface: FETCH,
    })
    expect(checkCommandSurface(entry, MCP)).toEqual({
      ok: false,
      field: 'file',
      codecKind: 'arg.fromString',
      surface: MCP,
    })
  })

  test('stored surface "all" accepts every concrete request', () => {
    const entry = commandEntry({ options: z.object({ x: allCodec() }) })
    expect(checkCommandSurface(entry, CLI)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, FETCH)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, MCP)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, SKILLS)).toEqual({ ok: true })
  })

  test('mcp-only codec accepts only the matching transport', () => {
    const entry = commandEntry({ options: z.object({ x: mcpOnlyCodec() }) })
    expect(checkCommandSurface(entry, MCP)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, CLI).ok).toBe(false)
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
    expect(checkCommandSurface(entry, SKILLS).ok).toBe(false)
  })

  test('bare positional codec is inspected (not just object fields)', () => {
    const entry = commandEntry({ args: cliOnlyCodec() })
    const result = checkCommandSurface(entry, FETCH)
    expect(result).toEqual({
      ok: false,
      field: '$',
      codecKind: 'arg.fromString',
      surface: FETCH,
    })
  })

  test('nested object codec field-path is dot-joined', () => {
    const entry = commandEntry({
      options: z.object({ outer: z.object({ inner: cliOnlyCodec() }) }),
    })
    const result = checkCommandSurface(entry, FETCH)
    expect(result).toEqual({
      ok: false,
      field: 'outer.inner',
      codecKind: 'arg.fromString',
      surface: FETCH,
    })
  })

  test('CLI-only codec rejects fetch from args position', () => {
    const entry = commandEntry({ args: z.object({ file: cliOnlyCodec() }) })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('CLI-only codec rejects fetch from options position', () => {
    const entry = commandEntry({ options: z.object({ file: cliOnlyCodec() }) })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('CLI-only codec rejects fetch from env position', () => {
    const entry = commandEntry({ env: z.object({ file: cliOnlyCodec() }) })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('GroupEntry returns ok regardless of surface', () => {
    const entry = { commands: new Map() } as unknown as Entry
    expect(checkCommandSurface(entry, FETCH)).toEqual({ ok: true })
  })

  test('undefined entry returns ok', () => {
    expect(checkCommandSurface(undefined, FETCH)).toEqual({ ok: true })
  })

  test('built-in arg helpers (no stored surface) pass every surface', () => {
    const entry = commandEntry({
      options: z.object({ replicas: arg.positiveInt(), port: arg.port(), debug: arg.boolean() }),
    })
    expect(checkCommandSurface(entry, CLI)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, FETCH)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, MCP)).toEqual({ ok: true })
  })
})

describe('checkCommandSurface — composite + wrapper recursion', () => {
  test('object wrapped in .optional() is still inspected', () => {
    const entry = commandEntry({
      options: z.object({ outer: z.object({ file: cliOnlyCodec() }).optional() }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('object wrapped in .default() is still inspected', () => {
    const entry = commandEntry({
      options: z.object({ outer: z.object({ file: cliOnlyCodec() }).default({ file: 'x' }) }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('object wrapped in .nullable(), .catch(), .readonly() is still inspected', () => {
    for (const wrap of [(s: any) => s.nullable(), (s: any) => s.catch({ file: 'x' }), (s: any) => s.readonly()]) {
      const entry = commandEntry({
        options: z.object({ outer: wrap(z.object({ file: cliOnlyCodec() })) }),
      })
      expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
    }
  })

  test('array element codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({ files: z.array(cliOnlyCodec()) }),
    })
    const result = checkCommandSurface(entry, FETCH)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.field).toBe('files[]')
  })

  test('tuple member codec is rejected with index in field path', () => {
    const entry = commandEntry({
      options: z.object({ pair: z.tuple([z.string(), cliOnlyCodec()]) }),
    })
    const result = checkCommandSurface(entry, FETCH)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.field).toBe('pair[1]')
  })

  test('tuple rest codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({ rest: z.tuple([z.string()], cliOnlyCodec()) }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('record value codec is rejected', () => {
    const entry = commandEntry({
      options: z.record(z.string(), cliOnlyCodec()),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('set element codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({ files: z.set(cliOnlyCodec()) }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('map value codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({ files: z.map(z.string(), cliOnlyCodec()) }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('union containing codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({ x: z.union([z.string(), cliOnlyCodec()]) }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('discriminated union variant with codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({
        shape: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), file: cliOnlyCodec() }),
          z.object({ kind: z.literal('b') }),
        ]),
      }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('intersection branch containing codec is rejected', () => {
    const entry = commandEntry({
      options: z.intersection(z.object({ a: z.string() }), z.object({ file: cliOnlyCodec() })),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('pipe, transform, and preprocess schemas are inspected', () => {
    for (const schema of [
      cliOnlyCodec().pipe(z.string()),
      cliOnlyCodec().transform((value) => value),
      z.preprocess((value) => value, cliOnlyCodec()),
    ]) {
      const entry = commandEntry({
        options: z.object({ file: schema }),
      })
      const result = checkCommandSurface(entry, FETCH)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected fail')
      expect(result.field).toBe('file')
    }
  })

  test('prefault, promise, and lazy schemas are inspected', () => {
    for (const schema of [cliOnlyCodec().prefault('x'), z.promise(cliOnlyCodec()), z.lazy(() => cliOnlyCodec())]) {
      const entry = commandEntry({
        options: z.object({ file: schema }),
      })
      const result = checkCommandSurface(entry, FETCH)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected fail')
      expect(result.field).toBe('file')
    }
  })

  test('object catchall codec is rejected', () => {
    const entry = commandEntry({
      options: z.object({
        meta: z.object({}).catchall(cliOnlyCodec()),
      }),
    })
    const result = checkCommandSurface(entry, FETCH)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.field).toBe('meta{}')
  })

  test('record and map key codecs are rejected', () => {
    for (const schema of [z.record(cliOnlyCodec(), z.string()), z.map(cliOnlyCodec(), z.string())]) {
      const entry = commandEntry({
        options: z.object({ values: schema }),
      })
      const result = checkCommandSurface(entry, FETCH)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected fail')
      expect(result.field).toBe('values{key}')
    }
  })

  test('recursive lazy schemas without codecs do not loop forever', () => {
    const node: any = z.lazy(() => z.object({ next: node.optional() }))
    const entry = commandEntry({
      options: z.object({ node }),
    })
    expect(checkCommandSurface(entry, FETCH)).toEqual({ ok: true })
  })

  test('deeply nested composite (object.optional > array > object) is inspected', () => {
    const entry = commandEntry({
      options: z.object({
        batch: z.object({ files: z.array(z.object({ src: cliOnlyCodec() })) }).optional(),
      }),
    })
    expect(checkCommandSurface(entry, FETCH).ok).toBe(false)
  })

  test('composite without any codec still passes', () => {
    const entry = commandEntry({
      options: z.object({
        files: z.array(z.string()).optional(),
        meta: z.record(z.string(), z.number()),
        shape: z.union([z.string(), z.number()]),
      }),
    })
    expect(checkCommandSurface(entry, FETCH)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, MCP)).toEqual({ ok: true })
  })
})

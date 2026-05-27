import { describe, expect, test } from 'bun:test'
import { arg } from '../src/schema/arg.js'
import { checkCommandSurface, type CommandSurface } from '../src/schema/surface.js'
import { z } from '../src/schema/zod.js'
import type { Entry } from '../src/types.js'

function commandEntry(runtime: { args?: any; options?: any; env?: any }): Entry {
  return { _command: true, contract: { name: 'x' } as any, runtime } as Entry
}

const FETCH: CommandSurface = 'fetch'
const CLI: CommandSurface = 'cli'
const MCP: CommandSurface = { kind: 'extension', transport: 'mcp' }
const SKILLS: CommandSurface = { kind: 'extension', transport: 'skills' }

const cliOnlyCodec = () => arg.fromString({ output: z.string(), decode: async (s) => s, surface: 'cli' })
const allCodec = () => arg.fromString({ output: z.string(), decode: async (s) => s, surface: 'all' })
const mcpOnlyCodec = () => arg.fromString({ output: z.string(), decode: async (s) => s, surface: MCP })

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

  test('FetchEntry returns ok regardless of surface (no runtime to inspect)', () => {
    const entry = { _fetch: true, contract: { name: 'x' } as any, fetch: () => new Response() } as unknown as Entry
    expect(checkCommandSurface(entry, FETCH)).toEqual({ ok: true })
    expect(checkCommandSurface(entry, MCP)).toEqual({ ok: true })
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

import { describe, expect, test } from 'bun:test'
import { arg, z } from '../src/index.js'
import { testCli, testCommand } from './helpers.js'

const cliOnlyCodec = () => arg.fromString({
  output: z.string(),
  decode: async (s: string) => s.toUpperCase(),
  surface: 'cli',
})

const allCodec = () => arg.fromString({
  output: z.string(),
  decode: async (s: string) => s.toUpperCase(),
  surface: 'all',
})

const fetchCodec = () => arg.fromString({
  output: z.string(),
  decode: async (s: string) => s.toUpperCase(),
  surface: 'fetch',
})

const mcpOnlyCodec = () => arg.fromString({
  output: z.string(),
  decode: async (s: string) => s.toUpperCase(),
  surface: { kind: 'extension', transport: 'mcp' },
})

function expectHandlerNeverRuns(): never {
  throw new Error('handler should not run for unsupported surface')
}

describe('cli.fetch UNSUPPORTED_SURFACE enforcement', () => {
  test('returns 400 + UNSUPPORTED_SURFACE for CLI-only codec in options on JSON path', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ file: cliOnlyCodec() }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload?file=https://example.com'))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    expect(body.error.details.codecKind).toBe('arg.fromString')
    expect(body.error.details.field).toBe('file')
    expect(body.error.details.surface).toBe('fetch')
  })

  test('returns 400 + UNSUPPORTED_SURFACE on the streaming branch too', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ file: cliOnlyCodec() }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload?file=https://example.com', {
      headers: { Accept: 'application/x-ndjson' },
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
  })

  test('surface "all" codec dispatches successfully via fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ file: allCodec() }),
      run: ({ options }: any) => ({ got: options.file }),
    })])

    const response = await cli.fetch(new Request('http://x/upload?file=hello'))
    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({ got: 'HELLO' })
  })

  test('surface "fetch" codec dispatches successfully via fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ file: fetchCodec() }),
      run: ({ options }: any) => ({ got: options.file }),
    })])

    const response = await cli.fetch(new Request('http://x/upload?file=hi'))
    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({ got: 'HI' })
  })

  test('mcp-only codec is rejected on fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ file: mcpOnlyCodec() }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload?file=hi'))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    // The error reports the failing request surface (fetch), not the stored codec surface (mcp).
    expect(body.error.details.surface).toBe('fetch')
  })

  test('bare positional CLI-only codec rejects fetch end-to-end', async () => {
    const cli = testCli('app', [testCommand('upload', {
      args: cliOnlyCodec(),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload', {
      method: 'POST',
      body: JSON.stringify({ args: 'hello' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    expect(body.error.details.field).toBe('$')
  })

  test('CLI-only codec in args (object) rejects fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      args: z.object({ file: cliOnlyCodec() }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload?file=hi'))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
  })

  test('CLI-only codec in env rejects fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      env: z.object({ FILE: cliOnlyCodec() }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload'))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
  })

  test('CLI-only codec inside a .optional() wrapper rejects fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({
        outer: z.object({ file: cliOnlyCodec() }).optional(),
      }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload', {
      method: 'POST',
      body: JSON.stringify({ outer: { file: 'hi' } }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    expect(body.error.details.field).toBe('outer.file')
  })

  test('CLI-only codec inside z.array() rejects fetch', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ files: z.array(cliOnlyCodec()) }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload', {
      method: 'POST',
      body: JSON.stringify({ files: ['a', 'b'] }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    expect(body.error.details.field).toBe('files[]')
  })

  test('CLI-only codec behind .pipe() rejects fetch before decode', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({ file: cliOnlyCodec().pipe(z.string()) }),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload', {
      method: 'POST',
      body: JSON.stringify({ file: 'hi' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    expect(body.error.details.field).toBe('file')
  })

  test('CLI-only codec in object catchall rejects fetch before decode', async () => {
    const cli = testCli('app', [testCommand('upload', {
      options: z.object({}).catchall(cliOnlyCodec()),
      run: () => expectHandlerNeverRuns(),
    })])

    const response = await cli.fetch(new Request('http://x/upload', {
      method: 'POST',
      body: JSON.stringify({ file: 'hi' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as any
    expect(body.error.code).toBe('UNSUPPORTED_SURFACE')
    expect(body.error.details.field).toBe('{}')
  })
})

import { describe, expect, test } from 'bun:test'
import { mcpServer } from '@liche/mcp-server'
import { testCli, testCommand } from './helpers.js'
import { run, z } from '../src/index.js'

const encoder = new TextEncoder()

function asyncIter<T>(values: T[]): AsyncIterable<T> {
  return (async function* () {
    for (const v of values) yield v
  })()
}

describe('RunOptions injection boundary', () => {
  test('isTty=true hides machine-only output and middleware sees isTty=true', async () => {
    let captured: { isTty?: boolean } = {}
    const stdout: string[] = []
    const stderr: string[] = []

    const cli = testCli('app', [testCommand('show', {
      outputPolicy: 'machine-only',
      run: ({ isTty }) => {
        captured.isTty = isTty
        return { hidden: true }
      },
    })])

    await run(cli, ['show'], {
      isTty: true,
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
    })

    expect(captured.isTty).toBe(true)
    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
  })

  test('isTty=false emits structured output for machine-only commands', async () => {
    let captured: { isTty?: boolean } = {}
    const stdout: string[] = []

    const cli = testCli('app', [testCommand('show', {
      outputPolicy: 'machine-only',
      run: ({ isTty }) => {
        captured.isTty = isTty
        return { hidden: true }
      },
    })])

    await run(cli, ['show'], {
      isTty: false,
      stdout: (s) => stdout.push(s),
    })

    expect(captured.isTty).toBe(false)
    expect(stdout.join('')).toContain('"hidden": true')
  })

  test('--json overrides machine-only policy on a TTY', async () => {
    const stdout: string[] = []
    const cli = testCli('app', [testCommand('show', {
      outputPolicy: 'machine-only',
      run: () => ({ hidden: true }),
    })])

    await run(cli, ['show', '--json'], {
      isTty: true,
      stdout: (s) => stdout.push(s),
    })

    expect(stdout.join('')).toContain('"ok": true')
    expect(stdout.join('')).toContain('"hidden": true')
  })

  test('error result formats human message when isTty=true and routes exit via options', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    let exitCode = 0

    const cli = testCli('app', [testCommand('fail', {
      run: ({ error }) => error({ code: 'NOPE', message: 'failed' }),
    })])

    await run(cli, ['fail'], {
      isTty: true,
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      exit: (code) => {
        exitCode = code
      },
    })

    expect(exitCode).toBe(1)
    expect(stdout.join('')).toContain('"code": "NOPE"')
    expect(stderr.join('')).toBe('Error (NOPE): failed\n')
  })

  test('env option overrides Bun.env without mutating globals', async () => {
    let observed: string | undefined
    const cli = testCli('app', [testCommand('show', {
      options: z.object({ token: z.string().default('fallback') }),
      sources: { options: { token: [{ provider: 'env', path: 'INJECTED_TOKEN' }] } },
      run: ({ options }) => {
        observed = options.token
        return { ok: true }
      },
    })])

    await run(cli, ['show'], {
      env: { INJECTED_TOKEN: 'value-from-options' },
      isTty: false,
      stdout: () => {},
    })

    expect(observed).toBe('value-from-options')
  })

  test('stdin option feeds MCP mode and JSON-RPC response goes to options.stdout', async () => {
    const stdout: string[] = []
    const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })

    const cli = testCli({ name: 'app', extensions: [mcpServer()] }, [testCommand('noop', { run: () => ({ ok: true }) })])

    await run(cli, ['--mcp'], {
      isTty: false,
      stdin: asyncIter([encoder.encode(`${initialize}\n`)]),
      stdout: (s) => stdout.push(s),
    })

    const lines = stdout.join('').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const response = JSON.parse(lines[0]!)
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(1)
    expect(response.result.serverInfo.name).toBe('app')
  })

  test('stdin accepts an AsyncIterable<string>', async () => {
    const stdout: string[] = []
    const cli = testCli({ name: 'app', extensions: [mcpServer()] }, [testCommand('noop', { run: () => ({ ok: true }) })])

    async function* stringChunks() {
      yield `${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize' })}\n`
    }

    await run(cli, ['--mcp'], {
      isTty: false,
      stdin: stringChunks(),
      stdout: (s) => stdout.push(s),
    })

    const response = JSON.parse(stdout.join('').trim())
    expect(response.id).toBe(7)
  })

  test('stdin accepts a ReadableStream<Uint8Array>', async () => {
    const stdout: string[] = []
    const cli = testCli({ name: 'app', extensions: [mcpServer()] }, [testCommand('noop', { run: () => ({ ok: true }) })])

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize' })}\n`))
        controller.close()
      },
    })

    await run(cli, ['--mcp'], {
      isTty: false,
      stdin: stream,
      stdout: (s) => stdout.push(s),
    })

    const response = JSON.parse(stdout.join('').trim())
    expect(response.id).toBe(9)
  })

  test('stdin splits across chunk boundaries', async () => {
    const stdout: string[] = []
    const cli = testCli({ name: 'app', extensions: [mcpServer()] }, [testCommand('noop', { run: () => ({ ok: true }) })])

    const msg1 = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const msg2 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const combined = `${msg1}\n${msg2}\n`
    const mid = Math.floor(combined.length / 2)

    await run(cli, ['--mcp'], {
      isTty: false,
      stdin: asyncIter([encoder.encode(combined.slice(0, mid)), encoder.encode(combined.slice(mid))]),
      stdout: (s) => stdout.push(s),
    })

    const lines = stdout.join('').split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).id).toBe(1)
    expect(JSON.parse(lines[1]!).id).toBe(2)
  })
})

import { describe, expect, test } from 'bun:test'

import * as Mcp from '../src/index.js'
import { stateOf, testCli, testCommand } from './helpers.js'

function request(id: string | number, method: string) {
  return { jsonrpc: '2.0', id, method }
}

async function* feedLines(...chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c
}

async function runMcp(cli: any, ...chunks: string[]) {
  let stdout = ''
  await Mcp.serveMcp('app', stateOf(cli), {
    stdin: feedLines(...chunks) as any,
    stdout: (s: string) => {
      stdout += s
    },
  })
  return stdout
}

describe('serveMcp', () => {
  test('emits one JSON response per newline-terminated request', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({ ok: true }) })])
    const out = await runMcp(cli, JSON.stringify(request(1, 'initialize')) + '\n')
    const lines = out.trim().split('\n')
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.id).toBe(1)
    expect(parsed.result.protocolVersion).toBe('2025-11-25')
  })

  test('skips blank lines (does not emit empty responses)', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const out = await runMcp(
      cli,
      '\n\n  \n' + JSON.stringify(request(5, 'initialize')) + '\n\n',
    )
    const lines = out.trim().split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]!).id).toBe(5)
  })

  test('processes multiple requests across separate chunks', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const out = await runMcp(
      cli,
      JSON.stringify(request(1, 'initialize')) + '\n',
      JSON.stringify(request(2, 'tools/list')) + '\n',
    )
    const responses = out.trim().split('\n').map((l) => JSON.parse(l))
    expect(responses.map((r) => r.id)).toEqual([1, 2])
  })

  test('handles request split across two chunks (buffer preserves partial)', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const full = JSON.stringify(request(1, 'initialize'))
    const out = await runMcp(cli, full.slice(0, 10), full.slice(10) + '\n')
    expect(JSON.parse(out.trim()).id).toBe(1)
  })

  test('processes trailing request without final newline', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const out = await runMcp(cli, JSON.stringify(request(99, 'initialize')))
    expect(JSON.parse(out.trim()).id).toBe(99)
  })

  test('accepts Uint8Array chunks via TextDecoder', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const bytes = new TextEncoder().encode(JSON.stringify(request(7, 'initialize')) + '\n')
    let stdout = ''
    async function* feedBytes(): AsyncIterable<Uint8Array> {
      yield bytes
    }
    await Mcp.serveMcp('app', stateOf(cli), {
      stdin: feedBytes() as any,
      stdout: (s: string) => {
        stdout += s
      },
    })
    expect(JSON.parse(stdout.trim()).id).toBe(7)
  })
})

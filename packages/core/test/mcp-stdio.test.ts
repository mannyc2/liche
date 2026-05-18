import { describe, expect, test } from 'bun:test'
import { Cli } from '../src/index.js'
import * as Mcp from '../src/mcp/index.js'
import { stateOf } from './helpers.js'

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
    const cli = Cli.create('app').command('run', { run: () => ({ ok: true }) })
    const out = await runMcp(cli, JSON.stringify({ id: 1, method: 'initialize' }) + '\n')
    const lines = out.trim().split('\n')
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.id).toBe(1)
    expect(parsed.result.protocolVersion).toBe('2025-06-18')
  })

  test('skips blank lines (does not emit empty responses)', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const out = await runMcp(
      cli,
      '\n\n  \n' + JSON.stringify({ id: 5, method: 'initialize' }) + '\n\n',
    )
    const lines = out.trim().split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]!).id).toBe(5)
  })

  test('processes multiple requests across separate chunks', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const out = await runMcp(
      cli,
      JSON.stringify({ id: 1, method: 'initialize' }) + '\n',
      JSON.stringify({ id: 2, method: 'tools/list' }) + '\n',
    )
    const responses = out.trim().split('\n').map((l) => JSON.parse(l))
    expect(responses.map((r) => r.id)).toEqual([1, 2])
  })

  test('handles request split across two chunks (buffer preserves partial)', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const full = JSON.stringify({ id: 1, method: 'initialize' })
    const out = await runMcp(cli, full.slice(0, 10), full.slice(10) + '\n')
    expect(JSON.parse(out.trim()).id).toBe(1)
  })

  test('processes trailing request without final newline', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const out = await runMcp(cli, JSON.stringify({ id: 99, method: 'initialize' }))
    expect(JSON.parse(out.trim()).id).toBe(99)
  })

  test('accepts Uint8Array chunks via TextDecoder', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const bytes = new TextEncoder().encode(JSON.stringify({ id: 7, method: 'initialize' }) + '\n')
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

import { describe, expect, test } from 'bun:test'
import { z } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { formatHumanValidationError } from '../src/cli/human-validation-error.js'
import type { SelectedCommand } from '../src/types.js'
import { testCli, testCommand } from './helpers.js'

function build(commandName: string, def: any) {
  const cli = testCli('app', [testCommand(commandName, { run: () => ({ ok: true }), ...def })])
  const state = (cli as InternalCli)[stateSymbol]
  const entry = state.commands.get(commandName) as any
  const selected: SelectedCommand = {
    argv: { args: [], options: {} },
    entry,
    events: [],
    hooks: { beforeExecute: [], prepareContext: [] },
    middlewares: [],
    path: [commandName],
  }
  return { state, selected }
}

describe('formatHumanValidationError', () => {
  test('missing required option uses --kebab-case label from argv source', () => {
    const { state, selected } = build('build', {
      options: z.object({ dryRun: z.boolean() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.dryRun', message: 'Required', missing: true, source: { kind: 'argv', flag: '--dry-run' } },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required option --dry-run')
  })

  test('missing required environment variable uses bare name from env source', () => {
    const { state, selected } = build('token', {
      env: z.object({ TOKEN: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.TOKEN', message: 'Required', missing: true, source: { kind: 'env', name: 'TOKEN' } },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required environment variable TOKEN')
  })

  test('invalid value for env var prefixes with "environment variable"', () => {
    const { state, selected } = build('token', {
      env: z.object({ TOKEN: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.TOKEN', message: 'Expected string', source: { kind: 'env', name: 'TOKEN' } },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: invalid value for environment variable TOKEN: Expected string')
  })

  test('invalid value for option does NOT use "environment variable" prefix', () => {
    const { state, selected } = build('build', {
      options: z.object({ mode: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.mode', message: 'Expected string', source: { kind: 'argv', flag: '--mode' } },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: invalid value for --mode: Expected string')
  })

  test('source-less top-level path "$" renders as bare input argument', () => {
    const { state, selected } = build('echo', {})
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$', message: 'Invalid', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required argument input')
  })

  test('source-less unknown path renders as neutral <name> argument', () => {
    const { state, selected } = build('build', {
      options: z.object({ mode: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.unknown', message: 'Required', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required argument <unknown>')
  })

  test('nested argv flag is rendered verbatim from source', () => {
    const { state, selected } = build('build', {
      options: z.object({ nested: z.object({ child: z.string() }) }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.nested.child', message: 'Required', missing: true, source: { kind: 'argv', flag: '--nested.child' } },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required option --nested.child')
  })

  test('output appends usage section and trailing help', () => {
    const { state, selected } = build('build', {
      options: z.object({ name: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.name', message: 'Required', missing: true, source: { kind: 'argv', flag: '--name' } },
    ])
    const lines = out.split('\n')
    expect(lines[0]).toBe('Error: missing required option --name')
    expect(lines).toContain('See below for usage.')
    expect(out).toContain('Usage:')
  })

  test('renders one error line per fieldError', () => {
    const { state, selected } = build('build', {
      options: z.object({ name: z.string(), mode: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.name', message: 'Required', missing: true, source: { kind: 'argv', flag: '--name' } },
      { path: '$.mode', message: 'Expected string', source: { kind: 'argv', flag: '--mode' } },
    ])
    const lines = out.split('\n')
    expect(lines[0]).toBe('Error: missing required option --name')
    expect(lines[1]).toBe('Error: invalid value for --mode: Expected string')
  })

  test('source argv flag is rendered verbatim (no double prefix)', () => {
    const { state, selected } = build('build', { options: z.object({ replicas: z.number() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.replicas', message: 'bad', source: { kind: 'argv', flag: '--replicas' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for --replicas: bad')
  })

  test('source argv positional uses arg name lookup', () => {
    const { state, selected } = build('go', { args: z.object({ name: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.name', message: 'bad', source: { kind: 'argv', positional: 0 } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for <name>: bad')
  })

  test('source env renders "environment variable NAME"', () => {
    const { state, selected } = build('start', { env: z.object({ PORT: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.PORT', message: 'bad', source: { kind: 'env', name: 'PORT' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for environment variable PORT: bad')
  })

  test('source provider renders provider:path label', () => {
    const { state, selected } = build('start', { options: z.object({ x: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.x', message: 'bad', source: { kind: 'provider', provider: 'config', path: 'x.y' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for config provider value x.y: bad')
  })

  test('source fetch-query renders query parameter label', () => {
    const { state, selected } = build('start', { options: z.object({ port: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.port', message: 'bad', source: { kind: 'fetch-query', key: 'port' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for query parameter ?port=: bad')
  })

  test('source fetch-body renders body field label', () => {
    const { state, selected } = build('start', { options: z.object({ port: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.port', message: 'bad', source: { kind: 'fetch-body', key: 'port' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for body field "port": bad')
  })

  test('source extension renders transport input label', () => {
    const { state, selected } = build('start', { options: z.object({ port: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.port', message: 'bad', source: { kind: 'extension', transport: 'mcp', key: 'port' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for mcp input "port": bad')
  })

  test('source programmatic renders input label', () => {
    const { state, selected } = build('start', { options: z.object({ port: z.string() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.port', message: 'bad', source: { kind: 'programmatic', key: 'port' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for input "port": bad')
  })

  test('source output renders "command output" label with the path', () => {
    const { state, selected } = build('ship', { output: z.object({ id: z.number() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.id', message: 'Expected number', source: { kind: 'output' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: invalid value for command output "$.id": Expected number')
  })

  test('missing required output field renders "command output missing required field"', () => {
    const { state, selected } = build('ship', { output: z.object({ id: z.number() }) })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.id', message: 'Required', missing: true, source: { kind: 'output' } },
    ])
    expect(out.split('\n')[0]).toBe('Error: command output missing required field "$.id"')
  })
})

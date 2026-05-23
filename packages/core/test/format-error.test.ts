import { describe, expect, test } from 'bun:test'
import { z } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { formatHumanValidationError } from '../src/cli/format-error.js'
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
    hooks: { beforeExecute: [] },
    middlewares: [],
    path: [commandName],
  }
  return { state, selected }
}

describe('formatHumanValidationError', () => {
  test('missing required option uses --kebab-case label', () => {
    const { state, selected } = build('build', {
      options: z.object({ dryRun: z.boolean() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.dryRun', message: 'Required', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required option --dry-run')
  })

  test('missing required environment variable uses bare name (not flag)', () => {
    const { state, selected } = build('token', {
      env: z.object({ TOKEN: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.TOKEN', message: 'Required', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required environment variable TOKEN')
  })

  test('invalid value for env var prefixes with "environment variable"', () => {
    const { state, selected } = build('token', {
      env: z.object({ TOKEN: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.TOKEN', message: 'Expected string' },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: invalid value for environment variable TOKEN: Expected string')
  })

  test('invalid value for option does NOT use "environment variable" prefix', () => {
    const { state, selected } = build('build', {
      options: z.object({ mode: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.mode', message: 'Expected string' },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: invalid value for --mode: Expected string')
  })

  test('top-level path "$" renders as bare input argument', () => {
    const { state, selected } = build('echo', {})
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$', message: 'Invalid', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required argument input')
  })

  test('unknown head renders as <name> argument and strips $.', () => {
    const { state, selected } = build('build', {
      options: z.object({ mode: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.unknown', message: 'Required', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required argument <unknown>')
  })

  test('nested option path appends .subkey suffix to flag', () => {
    const { state, selected } = build('build', {
      options: z.object({ nested: z.object({ child: z.string() }) }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.nested.child', message: 'Required', missing: true },
    ])
    const first = out.split('\n')[0]
    expect(first).toBe('Error: missing required option --nested.child')
  })

  test('output appends usage section and trailing help', () => {
    const { state, selected } = build('build', {
      options: z.object({ name: z.string() }),
    })
    const out = formatHumanValidationError('app', state, selected, [
      { path: '$.name', message: 'Required', missing: true },
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
      { path: '$.name', message: 'Required', missing: true },
      { path: '$.mode', message: 'Expected string' },
    ])
    const lines = out.split('\n')
    expect(lines[0]).toBe('Error: missing required option --name')
    expect(lines[1]).toBe('Error: invalid value for --mode: Expected string')
  })
})

import { describe, expect, test } from 'bun:test'
import { Cli, z } from '../src/index.js'

function captureRun(argv: string[], options: Parameters<typeof Cli.create>[1] | undefined, command: { name: string; def: Parameters<ReturnType<typeof Cli.create>['command']>[1] }) {
  let out = ''
  let err = ''
  let exitCode = 0
  const cli = Cli.create('app', options as any).command(command.name, command.def as any)
  const promise = cli.serve(argv, {
    stdout: (s) => { out += s },
    stderr: (s) => { err += s },
    exit: (code) => { exitCode = code },
    isTty: false,
  })
  return { promise, get out() { return out }, get err() { return err }, get exitCode() { return exitCode } }
}

describe('envelope mode — generated.machineOutput: "envelope"', () => {
  test('emits full {ok, data, meta} envelope under --json', async () => {
    const capture = captureRun(['ping', '--json'], {
      generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },
    }, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx) {
          return ctx.ok({ message: 'pong' }, { locality: { mode: 'local', source: 'schema-default' } })
        },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed.ok).toBe(true)
    expect(parsed.data).toEqual({ message: 'pong' })
    expect(parsed.meta).toEqual({ locality: { mode: 'local', source: 'schema-default' } })
  })

  test('handwritten CLI without `generated` returns bare data under --json (compat)', async () => {
    const capture = captureRun(['ping', '--json'], undefined, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx) { return ctx.ok({ message: 'pong' }) },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed).toEqual({ message: 'pong' })
  })
})

describe('disabledGlobals — reject --format on generated CLIs', () => {
  test('--format json is rejected before command run', async () => {
    const capture = captureRun(['ping', '--format', 'json'], {
      generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },
    }, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx) { return ctx.ok({ message: 'pong' }) },
      },
    })
    await capture.promise
    expect(capture.exitCode).toBe(1)
    expect(capture.err).toContain('--format is disabled')
  })

  test('handwritten CLI still accepts --format json', async () => {
    const capture = captureRun(['ping', '--format', 'json'], undefined, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx) { return ctx.ok({ message: 'pong' }) },
      },
    })
    await capture.promise
    expect(capture.exitCode).toBe(0)
    const parsed = JSON.parse(capture.out)
    expect(parsed).toEqual({ message: 'pong' })
  })
})

describe('ResultMeta — arbitrary keys round-trip through ctx.ok', () => {
  test('non-cta meta keys reach the result envelope under --full-output', async () => {
    const capture = captureRun(['ping', '--full-output', '--json'], undefined, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx) {
          return ctx.ok({ message: 'pong' }, { custom: { foo: 1 } })
        },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed.ok).toBe(true)
    expect(parsed.meta).toEqual({ custom: { foo: 1 } })
  })
})

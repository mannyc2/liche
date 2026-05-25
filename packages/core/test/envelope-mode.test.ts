import { describe, expect, test } from 'bun:test'
import { outputControls, z } from '../src/index.js'
import { testCli, testCommand } from './helpers.js'

function captureRun(argv: string[], options: any, command: { name: string; def: any }) {
  let out = ''
  let err = ''
  let exitCode = 0
  const cli = testCli('app', options ?? {}, [testCommand(command.name, command.def)])
  const promise = cli.serve(argv, {
    stdout: (s) => { out += s },
    stderr: (s) => { err += s },
    exit: (code) => { exitCode = code },
    isTty: false,
  })
  return { promise, get out() { return out }, get err() { return err }, get exitCode() { return exitCode } }
}

describe('envelope mode — generated.machineOutput: "envelope"', () => {
  test('emits full {ok, data, error, meta} envelope under --json', async () => {
    const capture = captureRun(['ping', '--json'], {
      generated: { machineOutput: 'envelope' },
    }, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx: any) {
          return ctx.ok({ message: 'pong' }, { locality: { mode: 'local', source: 'schema-default' } })
        },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed.ok).toBe(true)
    expect(parsed.data).toEqual({ message: 'pong' })
    expect(parsed.error).toBeNull()
    expect(parsed.meta).toEqual({ locality: { mode: 'local', source: 'schema-default' } })
  })

  test('emits full error envelope under --json', async () => {
    const capture = captureRun(['fail', '--json'], {
      generated: { machineOutput: 'envelope' },
    }, {
      name: 'fail',
      def: {
        run(ctx: any) {
          return ctx.error({ code: 'NOPE', message: 'failed' })
        },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed).toEqual({
      ok: false,
      data: null,
      error: {
        code: 'NOPE',
        detail: 'failed',
        exitCode: 1,
        message: 'failed',
        title: 'Nope',
        type: 'urn:liche:error:nope',
      },
    })
  })

  test('ctx.ok and ctx.error return control results instead of throwing', async () => {
    const success = captureRun(['inspect-ok', '--json'], {
      generated: { machineOutput: 'envelope' },
    }, {
      name: 'inspect-ok',
      def: {
        run(ctx: any) {
          const result = ctx.ok({ message: 'pong' })
          expect(result).toMatchObject({ ok: true, data: { message: 'pong' }, error: null })
          return result
        },
      },
    })
    await success.promise
    expect(JSON.parse(success.out)).toMatchObject({ ok: true, data: { message: 'pong' }, error: null })

    const failure = captureRun(['inspect-error', '--json'], {
      generated: { machineOutput: 'envelope' },
    }, {
      name: 'inspect-error',
      def: {
        run(ctx: any) {
          const result = ctx.error({ code: 'NOPE', message: 'failed' })
          expect(result).toMatchObject({ ok: false, data: null, error: { code: 'NOPE' } })
          return result
        },
      },
    })
    await failure.promise
    expect(JSON.parse(failure.out)).toMatchObject({ ok: false, data: null, error: { code: 'NOPE' } })
  })

  test('handwritten CLI without `generated` returns bare data under --json (compat)', async () => {
    const capture = captureRun(['ping', '--json'], undefined, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx: any) { return ctx.ok({ message: 'pong' }) },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed).toEqual({ message: 'pong' })
  })

  test('raw result-shaped handler returns are domain data, not control envelopes', async () => {
    const success = captureRun(['raw-success', '--json'], undefined, {
      name: 'raw-success',
      def: {
        run() {
          return { ok: true, data: { value: 1 }, error: null }
        },
      },
    })
    await success.promise
    expect(success.exitCode).toBe(0)
    expect(JSON.parse(success.out)).toEqual({ ok: true, data: { value: 1 }, error: null })

    const failureShapedData = captureRun(['raw-error', '--json'], undefined, {
      name: 'raw-error',
      def: {
        run() {
          return { ok: false, data: null, error: { code: 'DOMAIN_ERROR', message: 'domain data' } }
        },
      },
    })
    await failureShapedData.promise
    expect(failureShapedData.exitCode).toBe(0)
    expect(JSON.parse(failureShapedData.out)).toEqual({
      ok: false,
      data: null,
      error: { code: 'DOMAIN_ERROR', message: 'domain data' },
    })
  })
})

describe('generated CLIs install selected output controls explicitly', () => {
  test('--format json is rejected when generated output controls omit format', async () => {
    const capture = captureRun(['ping', '--format', 'json'], {
      generated: { machineOutput: 'envelope' },
      testControls: false,
      extensions: [outputControls({ json: true })],
    }, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx: any) { return ctx.ok({ message: 'pong' }) },
      },
    })
    await capture.promise
    expect(capture.exitCode).toBe(1)
    expect(JSON.parse(capture.out).error.message).toBe('Unknown option: --format')
  })

  test('handwritten CLI still accepts --format json', async () => {
    const capture = captureRun(['ping', '--format', 'json'], undefined, {
      name: 'ping',
      def: {
        output: z.object({ message: z.string() }),
        run(ctx: any) { return ctx.ok({ message: 'pong' }) },
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
        run(ctx: any) {
          return ctx.ok({ message: 'pong' }, { custom: { foo: 1 } })
        },
      },
    })
    await capture.promise
    const parsed = JSON.parse(capture.out)
    expect(parsed.ok).toBe(true)
    expect(parsed.error).toBeNull()
    expect(parsed.meta).toEqual({ custom: { foo: 1 } })
  })
})

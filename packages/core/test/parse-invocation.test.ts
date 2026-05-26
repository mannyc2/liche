import { describe, expect, test } from 'bun:test'
import { defineCommand, dispatch, parseInvocation, ParseError, z } from '../src/index.js'
import type { CliEvent, ParsedInvocation, ParseInvocationResult } from '../src/index.js'
import { isRuntimeResult } from '../src/errors/error.js'
import { testCli, testCommand } from './helpers.js'

function unwrap(result: ParseInvocationResult): ParsedInvocation {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data
}

describe('parseInvocation', () => {
  test('returns command + decoded input + sources for a runnable command', async () => {
    const cli = testCli('app', [
      testCommand('echo', {
        args: z.object({ msg: z.string() }),
        options: z.object({ count: z.coerce.number().default(1) }),
        run: ({ args, options }) => ({ msg: args.msg, count: options.count }),
      }),
    ])

    const result = await parseInvocation(cli, ['echo', 'hi', '--count', '3'])
    const data = unwrap(result)
    expect(data.command.path).toEqual(['echo'])
    expect(data.command.name).toBe('echo')
    expect((data.command.schema as { options?: unknown })?.options).toBeDefined()
    expect(data.input.args).toEqual({ msg: 'hi' })
    expect((data.input.options as { count: number }).count).toBe(3)
    expect(data.sources.option('count').kind).toBe('argv')
    expect(data.format).toBe('json')
    expect(data.formatExplicit).toBe(false)
    expect(data.warnings).toEqual([])
    expect(data.contextOverrides).toEqual({})
  })

  test('result is properly branded by ok() / fail()', async () => {
    const cli = testCli('app', [testCommand('go', { run: () => ({ ok: true }) })])

    const okResult = await parseInvocation(cli, ['go'])
    expect(isRuntimeResult(okResult)).toBe(true)

    const failResult = await parseInvocation(cli, ['nope'])
    expect(isRuntimeResult(failResult)).toBe(true)
  })

  test('failure error envelope is normalized through fail()', async () => {
    const cli = testCli('app', [
      testCommand('go', {
        options: z.object({ count: z.number() }),
        run: () => ({ ok: true }),
      }),
    ])

    const result = await parseInvocation(cli, ['go', '--count', 'not-a-number'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(result.error.detail).toBeDefined()
    expect(result.error.title).toBeDefined()
    expect(result.error.type).toBeDefined()
    expect(result.error.exitCode).toBeDefined()
  })

  test('handler is not called', async () => {
    let called = false
    const cli = testCli('app', [
      testCommand('go', {
        run: () => {
          called = true
          return { ok: true }
        },
      }),
    ])

    await parseInvocation(cli, ['go'])
    expect(called).toBe(false)
  })

  test('no lifecycle events fire on success or failure', async () => {
    const events: CliEvent[] = []
    const cli = testCli({
      name: 'app',
      events: [(event) => {
        events.push(event)
      }],
    }, [testCommand('go', { run: () => ({ ok: true }) })])

    await parseInvocation(cli, ['go'])
    await parseInvocation(cli, ['--help'])
    await parseInvocation(cli, ['nope'])
    await parseInvocation(cli, ['go', '--no-such-option'])

    expect(events).toEqual([])
  })

  test('does not write stdout/stderr and does not exit', async () => {
    const cli = testCli('app', [
      testCommand('go', {
        options: z.object({ n: z.number() }),
        run: () => ({ ok: true }),
      }),
    ])

    const stdoutWrite = Bun.stdout.write.bind(Bun.stdout)
    const stderrWrite = Bun.stderr.write.bind(Bun.stderr)
    const originalExit = process.exit
    let stdoutCalls = 0
    let stderrCalls = 0
    let exitCalled = false

    Bun.stdout.write = ((chunk: any) => {
      stdoutCalls++
      return stdoutWrite(chunk)
    }) as typeof Bun.stdout.write
    Bun.stderr.write = ((chunk: any) => {
      stderrCalls++
      return stderrWrite(chunk)
    }) as typeof Bun.stderr.write
    process.exit = ((code?: number) => {
      exitCalled = true
      throw new Error(`unexpected process.exit(${code})`)
    }) as typeof process.exit

    try {
      await parseInvocation(cli, ['go', '--n', '1'])
      await parseInvocation(cli, ['go', '--n', 'bad'])
      await parseInvocation(cli, ['--help'])
      expect(stdoutCalls).toBe(0)
      expect(stderrCalls).toBe(0)
      expect(exitCalled).toBe(false)
    } finally {
      Bun.stdout.write = stdoutWrite
      Bun.stderr.write = stderrWrite
      process.exit = originalExit
    }
  })

  test('deprecated options surface as warnings, not stderr', async () => {
    const cli = testCli('app', [
      testCommand('go', {
        options: z.object({
          legacy: z.boolean().meta({ deprecated: true }).default(false),
        }),
        run: () => ({ ok: true }),
      }),
    ])

    const result = await parseInvocation(cli, ['go', '--legacy'])
    const data = unwrap(result)
    expect(data.warnings).toContainEqual({ kind: 'deprecated-option', flag: '--legacy', option: 'legacy' })
  })

  test('source provenance: argv vs env vs default', async () => {
    const cli = testCli('app', [
      testCommand('go', {
        options: z.object({ foo: z.string().default('d') }),
        sources: { options: { foo: [{ provider: 'env', path: 'FOO' }] } },
        run: () => ({ ok: true }),
      }),
    ])

    const fromArgv = unwrap(await parseInvocation(cli, ['go', '--foo', 'a'], { env: { FOO: 'b' } }))
    expect(fromArgv.sources.option('foo').kind).toBe('argv')
    expect((fromArgv.input.options as { foo: string }).foo).toBe('a')

    const fromEnv = unwrap(await parseInvocation(cli, ['go'], { env: { FOO: 'b' } }))
    const envSource = fromEnv.sources.option('foo')
    expect(envSource.kind).toBe('provider')
    if (envSource.kind === 'provider') expect(envSource.provider).toBe('env')
    expect((fromEnv.input.options as { foo: string }).foo).toBe('b')

    const fromDefault = unwrap(await parseInvocation(cli, ['go'], { env: {} }))
    expect(fromDefault.sources.option('foo').kind).toBe('default')
    expect((fromDefault.input.options as { foo: string }).foo).toBe('d')
  })

  describe('gating mirrors dispatch by code', () => {
    const cli = testCli('app', [testCommand('hello', { run: () => ({ ok: true }) })])

    test('--help -> PARSE_ERROR', async () => {
      const result = await parseInvocation(cli, ['--help'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('--version -> PARSE_ERROR', async () => {
      const result = await parseInvocation(cli, ['--version'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('--schema -> PARSE_ERROR', async () => {
      const result = await parseInvocation(cli, ['hello', '--schema'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('empty argv -> COMMAND_NOT_FOUND', async () => {
      const result = await parseInvocation(cli, [])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('COMMAND_NOT_FOUND')
    })

    test('unknown command -> COMMAND_NOT_FOUND', async () => {
      const result = await parseInvocation(cli, ['nope'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('COMMAND_NOT_FOUND')
    })

    test('unknown leading option -> PARSE_ERROR', async () => {
      const result = await parseInvocation(cli, ['--no-such-option'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('COMPLETE env -> PARSE_ERROR', async () => {
      const result = await parseInvocation(cli, ['hello'], { env: { COMPLETE: 'bash' } })
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })
  })

  test('prepareContext ParseError surfaces as PARSE_ERROR', async () => {
    const cli = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => {
          throw new ParseError({ message: 'nope' })
        },
      },
    }, [testCommand('go', { run: () => ({ ok: true }) })])

    const result = await parseInvocation(cli, ['go'])
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    expect(result.ok ? null : result.error.message).toContain('nope')
  })

  test('prepareContext overrides reach input + contextOverrides', async () => {
    const cli = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => ({ patch: { options: { count: 999 } } }),
      },
    }, [
      testCommand('go', {
        options: z.object({ count: z.coerce.number().default(1) }),
        run: () => ({ ok: true }),
      }),
    ])

    const data = unwrap(await parseInvocation(cli, ['go', '--count', '1']))
    expect((data.input.options as { count: number }).count).toBe(999)
    expect((data.contextOverrides.options as { count: number } | undefined)?.count).toBe(999)
  })

  test('prepareContext format / formatExplicit / global patches reach top-level fields', async () => {
    const cli = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => ({
          patch: {
            format: 'text',
            formatExplicit: true,
            global: { profile: 'staging' },
          },
        }),
      },
    }, [testCommand('go', { run: () => ({ ok: true }) })])

    const data = unwrap(await parseInvocation(cli, ['go']))
    expect(data.format).toBe('text')
    expect(data.formatExplicit).toBe(true)
    expect(data.globals).toEqual({ profile: 'staging' })
    expect(data.contextOverrides.format).toBe('text')
    expect(data.contextOverrides.formatExplicit).toBe(true)
    expect(data.contextOverrides.globals).toEqual({ profile: 'staging' })
  })

  test('prepareContext failure is reported before non-runnable entry checks', async () => {
    const noRun = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => {
          throw new ParseError({ message: 'prep failed' })
        },
      },
    }, [testCommand('lonely', {})])
    const fetchOnly = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => {
          throw new ParseError({ message: 'prep failed' })
        },
      },
    }, [defineCommand({
      path: ['ping'],
      fetch: async () => new Response('pong'),
    })])

    for (const { cli, argv } of [
      { argv: ['lonely'], cli: noRun },
      { argv: ['ping'], cli: fetchOnly },
    ]) {
      const result = await parseInvocation(cli, argv)
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
      expect(result.ok ? null : result.error.message).toContain('prep failed')
    }
  })

  test('non-runnable command (no run handler) -> COMMAND_NOT_RUNNABLE', async () => {
    const cli = testCli('app', [testCommand('lonely', {})])

    const result = await parseInvocation(cli, ['lonely'])
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error.code).toBe('COMMAND_NOT_RUNNABLE')
  })

  test('fetch entry -> COMMAND_NOT_RUNNABLE (decision #11)', async () => {
    const fetchCmd = defineCommand({
      path: ['ping'],
      fetch: async () => new Response('pong'),
    })
    const cli = testCli('app', [fetchCmd])

    const result = await parseInvocation(cli, ['ping'])
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error.code).toBe('COMMAND_NOT_RUNNABLE')
  })

  test('dispatch is unchanged: still runs handlers normally', async () => {
    const cli = testCli('app', [
      testCommand('go', {
        options: z.object({ n: z.coerce.number().default(0) }),
        run: ({ options }) => ({ doubled: options.n * 2 }),
      }),
    ])

    const result = await dispatch(cli, ['go', '--n', '7'])
    expect(result.ok).toBe(true)
    expect(result.ok ? result.data : null).toEqual({ doubled: 14 })
  })
})

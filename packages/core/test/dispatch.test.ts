import { describe, expect, test } from 'bun:test'
import { dispatch, ParseError, run, z } from '../src/index.js'
import type { CliEvent, Result } from '../src/index.js'
import { runCli, testCli, testCommand } from './helpers.js'

function unwrap<T>(result: Result): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data as T
}

describe('dispatch', () => {
  test('returns Result.ok with data for a runnable command', async () => {
    const cli = testCli('app', [
      testCommand('greet', {
        options: z.object({ name: z.string().default('world') }),
        run: ({ options }) => ({ greeting: `hi ${options.name}` }),
      }),
    ])

    const result = await dispatch(cli, ['greet', '--name', 'liche'])
    expect(result.ok).toBe(true)
    expect(unwrap<{ greeting: string }>(result)).toEqual({ greeting: 'hi liche' })
  })

  test('matches serve --json data on success', async () => {
    const cli = testCli('app', [
      testCommand('echo', {
        args: z.object({ msg: z.string() }),
        run: ({ args }) => ({ msg: args.msg }),
      }),
    ])

    const dispatched = await dispatch(cli, ['echo', 'hello'])
    const served = await runCli(cli, ['echo', 'hello', '--json'])

    expect(dispatched.ok).toBe(true)
    expect(unwrap(dispatched)).toEqual(JSON.parse(served.stdout.trim()))
  })

  test('does not write stdout/stderr and does not exit', async () => {
    const cli = testCli('app', [
      testCommand('noop', {
        run: () => ({ noop: true }),
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
      const result = await dispatch(cli, ['noop'])
      expect(result.ok).toBe(true)
      expect(stdoutCalls).toBe(0)
      expect(stderrCalls).toBe(0)
      expect(exitCalled).toBe(false)
    } finally {
      Bun.stdout.write = stdoutWrite
      Bun.stderr.write = stderrWrite
      process.exit = originalExit
    }
  })

  test('forwards async generator chunks through onChunk and collects them into Result.data', async () => {
    const cli = testCli('app', [
      testCommand('stream', {
        run: async function* () {
          yield 1
          yield 2
          yield 3
        },
      }),
    ])

    const chunks: unknown[] = []
    const result = await dispatch(cli, ['stream'], {
      onChunk: (chunk) => {
        chunks.push(chunk)
      },
    })

    expect(result.ok).toBe(true)
    expect(chunks).toEqual([1, 2, 3])
    expect(unwrap<number[]>(result)).toEqual([1, 2, 3])
  })

  describe('non-runnable returns Result.fail with existing structured codes', () => {
    const cli = testCli('app', [
      testCommand('hello', { run: () => ({ ok: true }) }),
    ])

    test('empty argv -> COMMAND_NOT_FOUND', async () => {
      const result = await dispatch(cli, [])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('COMMAND_NOT_FOUND')
    })

    test('--help -> PARSE_ERROR', async () => {
      const result = await dispatch(cli, ['--help'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('--version -> PARSE_ERROR', async () => {
      const result = await dispatch(cli, ['--version'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('--schema on a selected command -> PARSE_ERROR', async () => {
      const result = await dispatch(cli, ['hello', '--schema'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('unknown command -> COMMAND_NOT_FOUND', async () => {
      const result = await dispatch(cli, ['nope'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('COMMAND_NOT_FOUND')
    })

    test('unknown leading option -> PARSE_ERROR', async () => {
      const result = await dispatch(cli, ['--no-such-option'])
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })

    test('COMPLETE env -> PARSE_ERROR', async () => {
      const result = await dispatch(cli, ['hello'], { env: { COMPLETE: 'bash' } })
      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    })
  })

  test('prepareContext ParseError is surfaced as Result.fail PARSE_ERROR', async () => {
    const cli = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => {
          throw new ParseError({ message: 'bad prep' })
        },
      },
    }, [testCommand('go', { run: () => ({ done: true }) })])

    const result = await dispatch(cli, ['go'])
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error.code).toBe('PARSE_ERROR')
    expect(result.ok ? null : result.error.message).toContain('bad prep')
  })

  test('non-ParseError thrown from prepareContext is normalized, not rethrown', async () => {
    const cli = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => {
          throw new Error('unexpected boom')
        },
      },
    }, [testCommand('go', { run: () => ({ done: true }) })])

    const result = await dispatch(cli, ['go'])
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error.message).toContain('unexpected boom')
  })

  describe('lifecycle events fire on pre-execute failures', () => {
    function collect(): { events: CliEvent[]; sub: (event: CliEvent) => void } {
      const events: CliEvent[] = []
      return { events, sub: (event) => { events.push(event) } }
    }

    test('parseGlobals failure emits parse.failed', async () => {
      const recorder = collect()
      const cli = testCli({
        name: 'app',
        events: [recorder.sub],
      }, [testCommand('go', { run: () => ({ done: true }) })])

      await dispatch(cli, ['--no-such-global'])
      const types = recorder.events.map((event) => event.type)
      expect(types).toContain('parse.failed')
    })

    test('unknown command emits command.not_found', async () => {
      const recorder = collect()
      const cli = testCli({
        name: 'app',
        events: [recorder.sub],
      }, [testCommand('go', { run: () => ({ done: true }) })])

      await dispatch(cli, ['nope'])
      const types = recorder.events.map((event) => event.type)
      expect(types).toContain('command.not_found')
    })

    test('display-only flags emit parse.failed', async () => {
      const recorder = collect()
      const cli = testCli({
        name: 'app',
        events: [recorder.sub],
      }, [testCommand('go', { run: () => ({ done: true }) })])

      await dispatch(cli, ['--help'])
      const types = recorder.events.map((event) => event.type)
      expect(types).toContain('parse.failed')
    })

    test('prepareContext failure emits parse.failed with command identified', async () => {
      const recorder = collect()
      const cli = testCli({
        name: 'app',
        events: [recorder.sub],
        hooks: {
          prepareContext: () => {
            throw new ParseError({ message: 'nope' })
          },
        },
      }, [testCommand('go', { run: () => ({ done: true }) })])

      await dispatch(cli, ['go'])
      const failure = recorder.events.find((event) => event.type === 'parse.failed')
      expect(failure).toBeDefined()
      expect(failure?.command?.path).toEqual(['go'])
    })

  })

  describe('isTty propagates to handler context', () => {
    test('isTty=true passes through', async () => {
      let captured: { isTty?: boolean } = {}
      const cli = testCli('app', [
        testCommand('go', {
          run: ({ isTty }) => {
            captured = { isTty }
            return { ok: true }
          },
        }),
      ])

      await dispatch(cli, ['go'], { isTty: true })
      expect(captured.isTty).toBe(true)
    })

    test('default isTty is false (programmatic caller)', async () => {
      let captured: { isTty?: boolean } = {}
      const cli = testCli('app', [
        testCommand('go', {
          run: ({ isTty }) => {
            captured = { isTty }
            return { ok: true }
          },
        }),
      ])

      await dispatch(cli, ['go'])
      expect(captured.isTty).toBe(false)
    })
  })

  test('rich CommandError-shaped thrown value is preserved through prepareContext', async () => {
    const cli = testCli({
      name: 'app',
      hooks: {
        prepareContext: () => {
          throw {
            code: 'RATE_LIMITED',
            message: 'too many requests',
            status: 429,
            retryable: true,
            retry_after: 30,
            hint: 'wait before retrying',
            details: { window: 'minute' },
          }
        },
      },
    }, [testCommand('go', { run: () => ({ done: true }) })])

    const result = await dispatch(cli, ['go'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error.code).toBe('RATE_LIMITED')
    expect(result.error.message).toBe('too many requests')
    expect(result.error.status).toBe(429)
    expect(result.error.retryable).toBe(true)
    expect(result.error.retry_after).toBe(30)
    expect(result.error.hint).toBe('wait before retrying')
    expect(result.error.details).toEqual({ window: 'minute' })
  })
})

describe('run', () => {
  test('matches cli.serve stdout/stderr/exitCode for a representative command', async () => {
    const cli = testCli('app', [
      testCommand('greet', {
        options: z.object({ name: z.string().default('world') }),
        run: ({ options }) => ({ greeting: `hi ${options.name}` }),
      }),
    ])

    let runStdout = ''
    let runStderr = ''
    let runExit = 0
    await run(cli, ['greet', '--name', 'liche', '--json'], {
      stdout: (s) => {
        runStdout += s
      },
      stderr: (s) => {
        runStderr += s
      },
      exit: (code) => {
        runExit = code
      },
    })

    const served = await runCli(cli, ['greet', '--name', 'liche', '--json'])

    expect(runStdout).toBe(served.stdout)
    expect(runStderr).toBe(served.stderr)
    expect(runExit).toBe(served.exitCode)
  })
})

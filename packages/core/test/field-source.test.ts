import { describe, expect, test } from 'bun:test'
import { arg, dispatch, z } from '../src/index.js'
import type { FieldError, Result } from '../src/index.js'
import { testCli, testCommand } from './helpers.js'
import { attachFieldSources } from '../src/schema/zod.js'
import { ValidationError } from '../src/errors/error.js'
import { execute } from '../src/cli/execute.js'
import { selectCommand } from '../src/command/registry.js'
import { stateOf } from './helpers.js'
import { fetchCli } from '../src/cli/fetch.js'

function failureFieldError(result: Result): FieldError {
  if (result.ok) throw new Error('expected failure result')
  const fields = (result.error as any).fieldErrors as FieldError[] | undefined
  if (!fields || fields.length === 0) {
    throw new Error(`expected fieldErrors on result.error: ${JSON.stringify(result.error)}`)
  }
  return fields[0]!
}

describe('FieldError.source — argv', () => {
  test('long-flag failure carries { kind: argv, flag: --replicas }', async () => {
    const cli = testCli('app', [
      testCommand('deploy', {
        options: z.object({ replicas: arg.positiveInt() }),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['deploy', '--replicas', '-3'])
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'argv', flag: '--replicas' })
  })

  test('short alias failure carries { kind: argv, flag: -r }', async () => {
    const cli = testCli('app', [
      testCommand('deploy', {
        alias: { replicas: 'r' },
        options: z.object({ replicas: arg.positiveInt() }),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['deploy', '-r', '0'])
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'argv', flag: '-r' })
  })

  test('positional arg failure carries { kind: argv, positional: 0 }', async () => {
    const cli = testCli('app', [
      testCommand('name', {
        args: z.object({ name: z.string().min(3) }),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['name', 'ab'])
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'argv', positional: 0 })
  })

  test('bare-positional schema failure carries { kind: argv, positional: 0 }', async () => {
    const cli = testCli('app', [
      testCommand('count', {
        args: arg.int(),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['count', 'abc'])
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'argv', positional: 0 })
  })
})

describe('FieldError.source — env', () => {
  test('missing required env carries { kind: env, name }', async () => {
    const cli = testCli('app', [
      testCommand('start', {
        env: z.object({ PORT: z.string() }),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['start'], { env: {} })
    const fe = failureFieldError(result)
    expect(fe.missing).toBe(true)
    expect(fe.source).toEqual({ kind: 'env', name: 'PORT' })
  })

  test('present-but-invalid env carries { kind: env, name }', async () => {
    const cli = testCli('app', [
      testCommand('start', {
        env: z.object({ PORT: arg.port() }),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['start'], { env: { PORT: '70000' } })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'env', name: 'PORT' })
  })
})

describe('FieldError.source — programmatic via execute', () => {
  async function makeSelected() {
    const cli = testCli('app', [
      testCommand('deploy', {
        args: z.object({ replicas: arg.positiveInt() }),
        options: z.object({ port: arg.port() }),
        run: () => ({}),
      }),
    ])
    const state = stateOf(cli)
    const selected = selectCommand(state, ['deploy'])!
    return { state, selected }
  }

  test('argv-empty execute with options dict tags option as programmatic', async () => {
    const { state, selected } = await makeSelected()
    const result = await execute('app', selected, {
      argvOptions: { args: [], options: { port: 70000 }, argsObject: { replicas: 1 } },
      displayName: 'app',
      env: {},
      events: state.events,
      format: 'json',
      formatExplicit: true,
      global: {},
      hooks: state.hooks,
      middlewares: state.middlewares,
    })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'programmatic', key: 'port' })
  })

  test('argv-empty execute with argsObject tags arg as programmatic', async () => {
    const { state, selected } = await makeSelected()
    const result = await execute('app', selected, {
      argvOptions: { args: [], argsObject: { replicas: -1 }, options: { port: 3000 } },
      displayName: 'app',
      env: {},
      events: state.events,
      format: 'json',
      formatExplicit: true,
      global: {},
      hooks: state.hooks,
      middlewares: state.middlewares,
    })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'programmatic', key: 'replicas' })
  })

  test('seeded options remain programmatic even when args.length > 0', async () => {
    // Direct execute() with positional argv AND a synthetic options dict. The
    // seeded option came from the caller (synthetic input), not from a `--port`
    // flag — tagging it as { kind: 'argv', flag: '--port' } would fabricate a
    // flag that never appeared on the command line.
    const cli = testCli('app', [
      testCommand('serve', {
        args: z.object({ mode: z.string() }),
        options: z.object({ port: arg.port() }),
        run: () => ({}),
      }),
    ])
    const state = stateOf(cli)
    const selected = selectCommand(state, ['serve'])!
    const result = await execute('app', selected, {
      argvOptions: { args: ['web'], options: { port: 70000 } },
      displayName: 'app',
      env: {},
      events: state.events,
      format: 'json',
      formatExplicit: true,
      global: {},
      hooks: state.hooks,
      middlewares: state.middlewares,
    })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'programmatic', key: 'port' })
  })

  test('argsObject keys remain programmatic even when args.length > 0', async () => {
    const cli = testCli('app', [
      testCommand('go', {
        args: z.object({ name: arg.positiveInt() }),
        run: () => ({}),
      }),
    ])
    const state = stateOf(cli)
    const selected = selectCommand(state, ['go'])!
    // argsObject is its own synthetic input path, even with positional args present.
    const result = await execute('app', selected, {
      argvOptions: { args: ['ignored'], argsObject: { name: -1 } },
      displayName: 'app',
      env: {},
      events: state.events,
      format: 'json',
      formatExplicit: true,
      global: {},
      hooks: state.hooks,
      middlewares: state.middlewares,
    })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'programmatic', key: 'name' })
  })
})

describe('FieldError.source — fetch query/body', () => {
  function buildCli() {
    const cli = testCli('app', [
      testCommand('start', {
        options: z.object({ port: arg.port() }),
        run: () => ({}),
      }),
    ])
    return cli
  }

  async function fetchAndParse(request: Request): Promise<any> {
    const cli = buildCli()
    const state = stateOf(cli)
    const response = await fetchCli('app', state, request)
    return await response.json()
  }

  test('query-string failure carries { kind: fetch-query, key }', async () => {
    const json = await fetchAndParse(new Request('http://x/start?port=70000'))
    expect(json.ok).toBe(false)
    expect(json.error.fieldErrors[0].source).toEqual({ kind: 'fetch-query', key: 'port' })
  })

  test('body failure carries { kind: fetch-body, key }', async () => {
    const json = await fetchAndParse(
      new Request('http://x/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port: 70000 }),
      }),
    )
    expect(json.error.fieldErrors[0].source).toEqual({ kind: 'fetch-body', key: 'port' })
  })

  test('body wins over query when both set the same key', async () => {
    const json = await fetchAndParse(
      new Request('http://x/start?port=3000', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port: 70000 }),
      }),
    )
    expect(json.error.fieldErrors[0].source).toEqual({ kind: 'fetch-body', key: 'port' })
  })

  test('streaming branch reports the same fetch source', async () => {
    const cli = buildCli()
    const state = stateOf(cli)
    const response = await fetchCli(
      'app',
      state,
      new Request('http://x/start?port=70000', { headers: { accept: 'application/x-ndjson' } }),
    )
    const text = await response.text()
    const lastLine = text.trim().split('\n').pop()!
    const envelope = JSON.parse(lastLine)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.fieldErrors[0].source).toEqual({ kind: 'fetch-query', key: 'port' })
  })
})

describe('attachFieldSources', () => {
  test('preserves cause and shortMessage on the new ValidationError', () => {
    const cause = new Error('upstream')
    const original = new ValidationError({
      message: 'Validation failed',
      cause,
      fieldErrors: [{ path: '$.a', message: 'bad' }],
    })
    const result = attachFieldSources(original, { a: { kind: 'env', name: 'A' } }) as ValidationError
    expect(result).toBeInstanceOf(ValidationError)
    expect(result.cause).toBe(cause)
    expect(result.shortMessage).toBe('Validation failed')
    expect(result.fieldErrors[0]!.source).toEqual({ kind: 'env', name: 'A' })
  })

  test('returns the input unchanged when not a ValidationError', () => {
    const other = new Error('not validation')
    expect(attachFieldSources(other, {})).toBe(other)
  })

  test('does not overwrite an already-set source', () => {
    const preset: any = { kind: 'fetch-body', key: 'x' }
    const original = new ValidationError({
      message: 'x',
      fieldErrors: [{ path: '$.x', message: 'bad', source: preset }],
    })
    const result = attachFieldSources(original, { x: { kind: 'env', name: 'X' } }) as ValidationError
    expect(result.fieldErrors[0]!.source).toBe(preset)
  })
})

describe('FieldError.source — provider', () => {
  test('env-provider-bound option failure carries { kind: provider, provider, path }', async () => {
    const cli = testCli('app', [
      testCommand('start', {
        options: z.object({ port: arg.port() }),
        sources: { options: { port: [{ provider: 'env', path: 'APP_PORT' }] } },
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['start'], { env: { APP_PORT: '70000' } })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'provider', provider: 'env', path: 'APP_PORT' })
  })

  test('argv overrides provider — source becomes argv', async () => {
    const cli = testCli('app', [
      testCommand('start', {
        options: z.object({ port: arg.port() }),
        sources: { options: { port: [{ provider: 'env', path: 'APP_PORT' }] } },
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['start', '--port', '70000'], { env: { APP_PORT: '3000' } })
    const fe = failureFieldError(result)
    expect(fe.source).toEqual({ kind: 'argv', flag: '--port' })
  })
})

describe('FieldError.source — JSON envelope round-trip', () => {
  test('source survives JSON.stringify/parse via dispatch', async () => {
    const cli = testCli('app', [
      testCommand('deploy', {
        options: z.object({ replicas: arg.positiveInt() }),
        run: () => ({}),
      }),
    ])
    const result = await dispatch(cli, ['deploy', '--replicas', '-3'])
    const roundTripped = JSON.parse(JSON.stringify(result))
    expect(roundTripped.error.fieldErrors[0].source).toEqual({ kind: 'argv', flag: '--replicas' })
  })
})

import { describe, expect, test } from 'bun:test'
import { arg, middleware, z } from '../src/index.js'
import * as Completions from '../src/completions/index.js'
import * as Mcp from '@liche/mcp-server'
import { mcpServer } from '@liche/mcp-server'
import { parseJsonOutput, runCli, testCli, testCommand } from './helpers.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'

describe('contract: command resolution and execution', () => {
  test('runs a root command when no subcommand matches', async () => {
    const cli = testCli('hello', {
      args: z.object({ name: z.string() }),
      run: ({ args }) => ({ message: `hello ${args.name}` }),
    })

    const result = await runCli(cli, ['Ada', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ message: 'hello Ada' })
  })

  test('subcommands take precedence over root commands', async () => {
    const cli = testCli('app', {
      args: z.object({ fallback: z.string().optional() }),
      run: () => ({ command: 'root' }),
    }, [testCommand('user', {
      args: z.object({ path: z.string() }),
      run: ({ args }) => ({ command: 'user', path: args.path }),
    })])

    const result = await runCli(cli, ['user', '42', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ command: 'user', path: '42' })
  })

  test('aliases resolve to the target command', async () => {
    const cli = testCli('app', [testCommand('inspect', {
      aliases: ['i'],
      args: z.object({ id: z.coerce.number() }),
      run: ({ args }) => ({ id: args.id }),
    })])

    const result = await runCli(cli, ['i', '123', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ id: 123 })
  })

  test('nested declarative paths preserve group commands and root-like children', async () => {
    const cli = testCli('app', [
      testCommand('rooted', {
        description: 'root command child',
        run: () => ({ command: 'rooted' }),
      }),
      testCommand('admin', {
        description: 'admin group',
        run: () => ({ command: 'admin-root' }),
      }),
      testCommand(['admin', 'audit'], {
        run: () => ({ command: 'audit' }),
      }),
    ])

    expect(parseJsonOutput((await runCli(cli, ['rooted', '--json'])).stdout)).toEqual({ command: 'rooted' })
    expect(parseJsonOutput((await runCli(cli, ['admin', '--json'])).stdout)).toEqual({ command: 'admin-root' })
    expect(parseJsonOutput((await runCli(cli, ['admin', 'audit', '--json'])).stdout)).toEqual({ command: 'audit' })
  })

})

describe('contract: args, flags, env, middleware', () => {
  test('parses positionals, aliases, booleans, --no flags, and -- literal boundary', async () => {
    const cli = testCli('app', [testCommand('build', {
      alias: { count: 'c' },
      args: z.object({ name: z.string(), literal: z.string().optional() }),
      options: z.object({
        cache: z.boolean().default(true),
        count: z.coerce.number(),
        enabled: z.boolean().default(false),
        saveDev: z.boolean().default(false),
      }),
      run: ({ args, options }) => ({ args, options }),
    })])

    const result = await runCli(cli, ['build', 'app', '-c', '2', '--enabled', '--no-cache', '--', '--save-dev', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({
      args: { literal: '--save-dev', name: 'app' },
      options: { cache: false, count: 2, enabled: true, saveDev: false },
    })
  })

  test('preserves explicit boolean false and numeric zero option values', async () => {
    const cli = testCli('app', [testCommand('run', {
      options: z.object({
        count: z.coerce.number().default(1),
        enabled: z.boolean().default(true),
      }),
      run: ({ options }) => options,
    })])

    const result = await runCli(cli, ['run', '--enabled=false', '--count=0', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ count: 0, enabled: false })
  })

  test('env input source populates option defaults from env (argv > env > default)', async () => {
    const make = () =>
      testCli('app', [testCommand('run', {
        options: z.object({ token: z.string().default('default') }),
        sources: { options: { token: [{ provider: 'env', path: 'MYAPP_TOKEN' }] } },
        run: ({ options }) => options,
      })])

    const fromEnv = await runCli(make(), ['run', '--json'], { env: { MYAPP_TOKEN: 'fromenv' } })
    expect(parseJsonOutput(fromEnv.stdout)).toEqual({ token: 'fromenv' })

    const argvWins = await runCli(make(), ['run', '--token', 'fromargv', '--json'], { env: { MYAPP_TOKEN: 'fromenv' } })
    expect(parseJsonOutput(argvWins.stdout)).toEqual({ token: 'fromargv' })

    const schemaDefault = await runCli(make(), ['run', '--json'], { env: {} })
    expect(parseJsonOutput(schemaDefault.stdout)).toEqual({ token: 'default' })
  })

  test('option source provenance distinguishes argv, provider, and schema default', async () => {
    const cli = testCli('app', [testCommand('run', {
      options: z.object({ region: z.string().default('iad') }),
      sources: { options: { region: [{ provider: 'env', path: 'APP_REGION' }] } },
      run: (ctx) => ({ region: ctx.options.region, source: ctx.sources.option('region') }),
    })])

    expect(parseJsonOutput((await runCli(cli, ['run', '--region', 'sfo', '--json'], { env: { APP_REGION: 'dfw' } })).stdout))
      .toEqual({ region: 'sfo', source: { kind: 'argv' } })
    expect(parseJsonOutput((await runCli(cli, ['run', '--json'], { env: { APP_REGION: 'dfw' } })).stdout))
      .toEqual({ region: 'dfw', source: { kind: 'provider', provider: 'env', path: 'APP_REGION', source: { kind: 'env', name: 'APP_REGION' } } })
    expect(parseJsonOutput((await runCli(cli, ['run', '--json'], { env: {} })).stdout))
      .toEqual({ region: 'iad', source: { kind: 'default' } })
  })

  test('validates command env from the supplied run env', async () => {
    const cli = testCli('app', [testCommand('token', {
      env: z.object({ TOKEN: z.string() }),
      run: ({ env }) => ({ token: env.TOKEN }),
    })])

    const result = await runCli(cli, ['token', '--json'], { env: { TOKEN: 'secret' } })
    expect(parseJsonOutput(result.stdout)).toEqual({ token: 'secret' })
  })

  test('returns a validation error when required env is missing', async () => {
    const cli = testCli('app', [testCommand('token', {
      env: z.object({ TOKEN: z.string() }),
      run: ({ env }) => ({ token: env.TOKEN }),
    })])

    const result = await runCli(cli, ['token', '--json'], { env: {} })
    expect(result.exitCode).toBe(1)
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        fieldErrors: [{ path: '$.TOKEN' }],
      },
    })
  })

  test('runs middleware around command handlers and exposes vars', async () => {
    const cli = testCli('app', {
      middleware: [middleware(async (ctx, next) => {
        ;(ctx.var['trace'] as string[]).push('before')
        await next()
        ;(ctx.var['trace'] as string[]).push('after')
      })],
      vars: z.object({ trace: z.array(z.string()).default([]) }),
    }, [testCommand('trace', {
        run: ({ var: vars }) => {
          ;(vars['trace'] as string[]).push('run')
          return { trace: vars['trace'] }
        },
      })])

    const result = await runCli(cli, ['trace', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ trace: ['before', 'run', 'after'] })
  })
})

describe('contract: fetch and schema', () => {
  test('fetch dispatches HTTP paths to commands and returns an envelope', async () => {
    const cli = testCli('api', [testCommand('users', {
      args: z.object({ id: z.coerce.number() }),
      options: z.object({ active: z.coerce.boolean().default(false), limit: z.coerce.number().default(10) }),
      run: ({ args, options }) => ({ active: options.active, id: args.id, limit: options.limit }),
    })])

    const response = await cli.fetch(new Request('http://localhost/users/7?active=true&limit=3'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { active: true, id: 7, limit: 3 }, error: null })
  })

  test('fetch dispatch merges JSON body options and normalizes not found and validation errors', async () => {
    const cli = testCli('api', [testCommand('users', {
      args: z.object({ id: z.coerce.number() }),
      options: z.object({ active: z.boolean(), limit: z.number() }),
      run: ({ args, options }) => ({ id: args.id, options }),
    })])

    const response = await cli.fetch(
      new Request('http://localhost/users/7', {
        body: JSON.stringify({ active: false, limit: 5 }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { id: 7, options: { active: false, limit: 5 } }, error: null })

    const missing = await cli.fetch(new Request('http://localhost/missing'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ ok: false, data: null, error: { code: 'COMMAND_NOT_FOUND' } })

    const invalid = await cli.fetch(new Request('http://localhost/users/not-a-number?active=true&limit=5'))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ ok: false, data: null, error: { code: 'VALIDATION_ERROR' } })
  })

  test('fetch exposes MCP endpoint, HEAD behavior, and invalid JSON fallback', async () => {
    const cli = testCli('api', { version: '3.0.0', extensions: [mcpServer()] }, [testCommand('echo', {
      options: z.object({ message: z.string().default('empty') }),
      run: ({ options }) => ({ message: options.message }),
    })])

    const mcp = await cli.fetch(
      new Request('http://localhost/mcp', {
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        method: 'POST',
      }),
    )
    expect(await mcp.json()).toMatchObject({ id: 1, result: { tools: [{ name: 'echo' }] } })

    const head = await cli.fetch(new Request('http://localhost/echo?message=head', { method: 'HEAD' }))
    expect(head.status).toBe(200)

    const invalidJson = await cli.fetch(
      new Request('http://localhost/echo', {
        body: 'not json',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(await invalidJson.json()).toEqual({ ok: true, data: { message: 'empty' }, error: null })
  })

  test('schema output is generated from Zod, not hand-written fixtures', async () => {
    const cli = testCli('app', [testCommand('ship', {
      args: z.object({ version: z.string().describe('release version') }),
      options: z.object({ dryRun: z.boolean().default(false).describe('do not publish') }),
      run: () => ({ ok: true }),
    })])

    const result = await runCli(cli, ['ship', '--schema', '--json'])
    const schema = parseJsonOutput(result.stdout)
    expect(schema.args.properties.version.description).toBe('release version')
    expect(schema.options.properties.dryRun.description).toBe('do not publish')
  })

  test('output validation rejects handler results that do not match the output schema', async () => {
    const cli = testCli('app', [testCommand('ship', {
      output: z.object({ id: z.number() }),
      run: () => ({ id: 'not-a-number' }),
    })])

    const result = await runCli(cli, ['ship', '--json'])
    expect(result.exitCode).toBe(1)
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        fieldErrors: [{ path: '$.id' }],
      },
    })
  })

  test('output validation awaits async output codecs and decodes handler results', async () => {
    const cli = testCli('app', [testCommand('ship', {
      output: z.object({
        name: z.string().transform(async (s) => s.toUpperCase()),
      }),
      run: () => ({ name: 'ada' }),
    })])

    const result = await runCli(cli, ['ship', '--json'])
    expect(result.exitCode).toBe(0)
    expect(parseJsonOutput(result.stdout)).toEqual({ name: 'ADA' })
  })

  test('async output validation failures normalize into VALIDATION_ERROR', async () => {
    const cli = testCli('app', [testCommand('ship', {
      output: z.object({
        name: z.string().refine(async (s) => s.length >= 3, 'too short (async)'),
      }),
      run: () => ({ name: 'a' }),
    })])

    const result = await runCli(cli, ['ship', '--json'])
    expect(result.exitCode).toBe(1)
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        fieldErrors: [{ path: '$.name' }],
      },
    })
  })
})

describe('contract: mcp, completions, and token behavior', () => {
  test('mcp initialize, tools/list, tools/call, and unknown method use JSON-RPC envelopes', async () => {
    const cli = testCli('app', { version: '1.2.3' }, [testCommand('echo', {
      args: z.object({ message: z.string() }),
      run: ({ args }) => ({ message: args.message }),
    })])
    const state = (cli as InternalCli)[stateSymbol]

    await expect(Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'initialize' })).resolves.toMatchObject({
      id: 1,
      jsonrpc: '2.0',
      result: { serverInfo: { name: 'app', version: '1.2.3' } },
    })
    await expect(Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).resolves.toMatchObject({
      id: 2,
      result: { tools: [{ name: 'echo' }] },
    })
    await expect(
      Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { args: { message: 'hi' } } } }),
    ).resolves.toMatchObject({
      id: 3,
      result: { content: [{ text: '{"message":"hi"}', type: 'text' }], isError: false },
    })
    await expect(Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 4, method: 'missing' })).resolves.toMatchObject({
      error: { code: -32601 },
      id: 4,
      jsonrpc: '2.0',
    })
  })

  test('completions include commands and aliases without duplicates', () => {
    const cli = testCli('app', [testCommand('inspect', { aliases: ['i'], run: () => ({ ok: true }) }), testCommand('install', { run: () => ({ ok: true }) })])
    const state = (cli as InternalCli)[stateSymbol]

    expect(Completions.complete(state, ['i'], 0)).toEqual(['inspect', 'install', 'i'])
  })

  test('completion requests run through the public CLI path', async () => {
    const cli = testCli('app', [testCommand('inspect', { aliases: ['i'], run: () => ({ ok: true }) }), testCommand('install', { run: () => ({ ok: true }) })])

    const result = await runCli(cli, ['--', 'i'], { env: { COMPLETE: 'bash' } })
    expect(result.stdout.trim().split('\n')).toEqual(['inspect', 'install', 'i'])
    expect(result.stderr).toBe('')
  })

  test('completion requests include only registered top-level commands', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({ ok: true }) })])

    const result = await runCli(cli, ['--'], { env: { COMPLETE: 'bash' } })
    expect(result.stdout.trim().split('\n')).toEqual(['run'])
  })

  test('command-level default format is used unless a global format is explicit', async () => {
    const cli = testCli('app', [
      testCommand('render', {
        format: 'md',
        output: z.string(),
        run: () => '# rendered',
      }),
    ])

    const plain = await runCli(cli, ['render'])
    expect(plain.stdout).toBe('# rendered\n')

    const json = await runCli(cli, ['render', '--json'])
    expect(parseJsonOutput(json.stdout)).toBe('# rendered')
  })

  test('agent helper commands are not available unless enabled', async () => {
    const cli = testCli('app', [testCommand('list', { run: () => ({ command: 'list' }) })])

    const skills = await runCli(cli, ['skills', 'list', '--json'])
    expect(skills.stdout).toContain('Usage: app <command>')
    expect(skills.stdout).not.toContain('skills list')
  })

  test('core registers no helper commands by default', async () => {
    const minimal = testCli('minimal', [testCommand('list', { run: () => ({ command: 'list' }) })])
    const minimalHelp = await runCli(minimal, ['--help'])
    expect(minimalHelp.stdout).not.toContain('mcp add')
    expect(minimalHelp.stdout).not.toContain('skills add')
  })

  test('run handles version, full output, filters, token limits, and CTA metadata', async () => {
    const cli = testCli('app', { version: '2.0.0' }, [testCommand('deploy', {
      run: ({ ok }) =>
        ok(
          { nested: { keep: 'yes', skip: 'no' }, status: 'ready' },
          { cta: { commands: [{ command: 'status', options: { verbose: true } }], description: 'Next:' } },
        ),
    })])

    const version = await runCli(cli, ['--version'])
    expect(version.stdout).toBe('2.0.0\n')

    const full = await runCli(cli, ['deploy', '--json', '--full-output'])
    expect(parseJsonOutput(full.stdout)).toEqual({
      data: { nested: { keep: 'yes', skip: 'no' }, status: 'ready' },
      error: null,
      meta: { cta: { commands: [{ command: 'status', options: { verbose: true } }], description: 'Next:' } },
      ok: true,
    })

    const filtered = await runCli(cli, ['deploy', '--json', '--filter-output', 'nested.keep'])
    expect(parseJsonOutput(filtered.stdout)).toEqual({ nested: { keep: 'yes' } })
    expect(filtered.stderr).toBe('Next:\n  app status --verbose\n')

    const counted = await runCli(cli, ['deploy', '--json', '--token-count'])
    expect(Number(counted.stdout.trim())).toBeGreaterThan(0)

    const limited = await runCli(cli, ['deploy', '--json', '--token-limit', '1'])
    expect(limited.stdout).toContain('[truncated: showing tokens 0-1')

    const offset = await runCli(cli, ['deploy', '--json', '--token-offset', '1'])
    expect(offset.stdout).not.toEqual((await runCli(cli, ['deploy', '--json'])).stdout)
  })

  test('run handles completion errors, empty completions, default version, and MCP mode', async () => {
    const cli = testCli('app')

    const badCompletion = await runCli(cli, ['--'], { env: { COMPLETE: 'powershell' } })
    expect(badCompletion.stdout).toBe('')
    expect(badCompletion.stderr).toContain("Unknown completion shell 'powershell'. Supported: bash, zsh, fish")

    const emptyCompletion = await runCli(cli, ['run', 'nested', ''], { env: { COMPLETE: 'bash' } })
    expect(emptyCompletion.stdout).toBe('')

    const version = await runCli(cli, ['--version'])
    expect(version.stdout).toBe('0.0.0\n')
  })

  test('run honors machine-only output policy unless full output is requested', async () => {
    const cli = testCli('app', [testCommand('quiet', {
      outputPolicy: 'machine-only',
      run: () => ({ hidden: true }),
    })])

    const normal = await runCli(cli, ['quiet', '--json'])
    expect(normal.stdout).toBe('{\n  "hidden": true\n}\n')

    const full = await runCli(cli, ['quiet', '--json', '--full-output'])
    expect(parseJsonOutput(full.stdout)).toEqual({ ok: true, data: { hidden: true }, error: null })
  })

  test('run normalizes ctx.error exit codes and command-not-runnable errors', async () => {
    const cli = testCli('app', [testCommand('fail', {
        run: ({ error }) => error({
          code: 'NOPE',
          code_actions: [{ title: 'Inspect', argv: ['status'] }],
          detail: 'full failure detail',
          details: { id: 'err_1' },
          exitCode: 7,
          fieldErrors: [{ path: '$.name', message: 'Required' }],
          message: 'failed',
          retry_after: 5,
          retryable: true,
          status: 409,
          suggested_fix: 'Choose another name.',
          title: 'Nope',
          type: 'urn:test:nope',
        }),
      }), testCommand('empty', {})])

    const fail = await runCli(cli, ['fail', '--json'])
    expect(fail.exitCode).toBe(7)
    expect(parseJsonOutput(fail.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'NOPE',
        code_actions: [{ title: 'Inspect', argv: ['status'] }],
        detail: 'full failure detail',
        details: { id: 'err_1' },
        exitCode: 7,
        fieldErrors: [{ path: '$.name', message: 'Required' }],
        message: 'failed',
        retry_after: 5,
        retryable: true,
        status: 409,
        suggested_fix: 'Choose another name.',
        title: 'Nope',
        type: 'urn:test:nope',
      },
    })

    const empty = await runCli(cli, ['empty', '--json'])
    expect(empty.exitCode).toBe(1)
    expect(parseJsonOutput(empty.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'COMMAND_NOT_RUNNABLE',
        detail: 'Command has no run handler',
        message: 'Command has no run handler',
        title: 'Command Not Runnable',
        type: 'urn:liche:error:command-not-runnable',
      },
    })
  })

})

describe('contract: arg.boolean parser integration', () => {
  function booleanCli() {
    return testCli('app', [testCommand('run', {
      alias: { yes: 'y' },
      options: z.object({
        yes: arg.boolean().default(false),
      }),
      run: ({ options, args }: any) => ({ args, options }),
    })])
  }

  test('--yes sets true without consuming next argv token', async () => {
    const result = await runCli(booleanCli(), ['run', '--yes', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ args: {}, options: { yes: true } })
  })

  test('--yes positional treats positional as positional, not flag value', async () => {
    const cli = testCli('app', [testCommand('run', {
      args: z.object({ name: z.string().optional() }),
      options: z.object({ yes: arg.boolean().default(false) }),
      run: ({ options, args }: any) => ({ args, options }),
    })])
    const result = await runCli(cli, ['run', '--yes', 'positional', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({
      args: { name: 'positional' },
      options: { yes: true },
    })
  })

  test('--no-yes sets false', async () => {
    const result = await runCli(booleanCli(), ['run', '--no-yes', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ args: {}, options: { yes: false } })
  })

  test('--yes=true and --yes=false parse explicit literals', async () => {
    const trueResult = await runCli(booleanCli(), ['run', '--yes=true', '--json'])
    expect(parseJsonOutput(trueResult.stdout)).toEqual({ args: {}, options: { yes: true } })
    const falseResult = await runCli(booleanCli(), ['run', '--yes=false', '--json'])
    expect(parseJsonOutput(falseResult.stdout)).toEqual({ args: {}, options: { yes: false } })
  })

  test('-y alias sets true', async () => {
    const result = await runCli(booleanCli(), ['run', '-y', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ args: {}, options: { yes: true } })
  })

  test('omitted falls back to default', async () => {
    const result = await runCli(booleanCli(), ['run', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ args: {}, options: { yes: false } })
  })
})

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli, Config, Formatter, middleware, z } from '../src/index.js'
import * as Completions from '../src/completions/index.js'
import * as Mcp from '../src/mcp/index.js'
import { parseJsonOutput, runCli } from './helpers.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'

describe('contract: command resolution and execution', () => {
  test('runs a root command when no subcommand matches', async () => {
    const cli = Cli.create('hello', {
      args: z.object({ name: z.string() }),
      run: ({ args }) => ({ message: `hello ${args.name}` }),
    })

    const result = await runCli(cli, ['Ada', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ message: 'hello Ada' })
  })

  test('subcommands take precedence over root commands', async () => {
    const cli = Cli.create('app', {
      args: z.object({ fallback: z.string().optional() }),
      run: () => ({ command: 'root' }),
    }).command('user', {
      args: z.object({ path: z.string() }),
      run: ({ args }) => ({ command: 'user', path: args.path }),
    })

    const result = await runCli(cli, ['user', '42', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ command: 'user', path: '42' })
  })

  test('aliases resolve to the target command', async () => {
    const cli = Cli.create('app').command('inspect', {
      aliases: ['i'],
      args: z.object({ id: z.coerce.number() }),
      run: ({ args }) => ({ id: args.id }),
    })

    const result = await runCli(cli, ['i', '123', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ id: 123 })
  })

  test('mounting child CLIs preserves group commands and root-only children', async () => {
    const rootOnly = Cli.create('rooted', {
      description: 'root command child',
      run: () => ({ command: 'rooted' }),
    })
    const grouped = Cli.create('admin', {
      description: 'admin group',
      run: () => ({ command: 'admin-root' }),
    }).command('audit', {
      run: () => ({ command: 'audit' }),
    })
    const cli = Cli.create('app').command(rootOnly).command(grouped)

    expect(parseJsonOutput((await runCli(cli, ['rooted', '--json'])).stdout)).toEqual({ command: 'rooted' })
    expect(parseJsonOutput((await runCli(cli, ['admin', '--json'])).stdout)).toEqual({ command: 'admin-root' })
    expect(parseJsonOutput((await runCli(cli, ['admin', 'audit', '--json'])).stdout)).toEqual({ command: 'audit' })
  })

  test('fetch-only command registration proxies requests from the CLI path', async () => {
    const cli = Cli.create('app').command('remote', {
      basePath: '/api',
      fetch: async (request) =>
        Response.json({
          body: await request.text(),
          method: request.method,
          path: new URL(request.url).pathname,
        }),
    })

    const result = await runCli(cli, ['remote', 'users', '-X', 'post', '--data', '{"name":"Ada"}', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({
      body: '{"name":"Ada"}',
      method: 'POST',
      path: '/api/users',
    })
  })
})

describe('contract: args, flags, config, env, middleware', () => {
  test('parses positionals, aliases, booleans, --no flags, and -- literal boundary', async () => {
    const cli = Cli.create('app').command('build', {
      alias: { count: 'c' },
      args: z.object({ name: z.string(), literal: z.string().optional() }),
      options: z.object({
        cache: z.boolean().default(true),
        count: z.coerce.number(),
        enabled: z.boolean().default(false),
        saveDev: z.boolean().default(false),
      }),
      run: ({ args, options }) => ({ args, options }),
    })

    const result = await runCli(cli, ['build', 'app', '-c', '2', '--enabled', '--no-cache', '--', '--save-dev', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({
      args: { literal: '--save-dev', name: 'app' },
      options: { cache: false, count: 2, enabled: true, saveDev: false },
    })
  })

  test('preserves explicit boolean false and numeric zero option values', async () => {
    const cli = Cli.create('app').command('run', {
      options: z.object({
        count: z.coerce.number().default(1),
        enabled: z.boolean().default(true),
      }),
      run: ({ options }) => options,
    })

    const result = await runCli(cli, ['run', '--enabled=false', '--count=0', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ count: 0, enabled: false })
  })

  test('optionEnv populates option defaults from env (argv > env > config > default)', async () => {
    const make = () =>
      Cli.create('app', {
        config: Config.object({
          schema: z.object({ tokenDefault: z.string().default('fromconfig') }),
        }),
      }).command('run', {
        options: z.object({ token: z.string().default('default') }),
        optionEnv: { token: 'MYAPP_TOKEN' },
        optionConfig: { token: 'tokenDefault' },
        run: ({ options }) => options,
      })

    const fromEnv = await runCli(make(), ['run', '--json'], { env: { MYAPP_TOKEN: 'fromenv' } })
    expect(parseJsonOutput(fromEnv.stdout)).toEqual({ token: 'fromenv' })

    const argvWins = await runCli(make(), ['run', '--token', 'fromargv', '--json'], { env: { MYAPP_TOKEN: 'fromenv' } })
    expect(parseJsonOutput(argvWins.stdout)).toEqual({ token: 'fromargv' })

    const configFallback = await runCli(make(), ['run', '--json'], { env: {} })
    expect(parseJsonOutput(configFallback.stdout)).toEqual({ token: 'fromconfig' })
  })

  test('first-class config exposes ctx.config, explicit option bindings, and source provenance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lili-config-contract-'))
    try {
      const path = join(dir, 'app.jsonc')
      writeFileSync(path, `{
        // JSONC comments are allowed.
        "baseUrl": "https://api.example.test",
        "defaultOrg": "org_config",
        "timeoutMs": 2500
      }`)
      const cli = Cli.create('app', {
        config: Config.object({
          files: [path],
          schema: z.strictObject({
            baseUrl: z.string().url().default('https://default.example.test'),
            defaultOrg: z.string(),
            timeoutMs: z.coerce.number().default(1000),
          }),
        }),
      }).command('deploy', {
        options: z.object({
          org: z.string(),
          timeoutMs: z.coerce.number(),
          loose: z.string().default('schema'),
        }),
        optionConfig: {
          org: 'defaultOrg',
          timeoutMs: 'timeoutMs',
        },
        run: (ctx) => ({
          baseUrl: ctx.config['baseUrl'],
          baseUrlSource: ctx.sources.config('baseUrl').kind,
          looseSource: ctx.sources.option('loose'),
          org: ctx.options.org,
          orgSource: ctx.sources.option('org'),
          timeoutMs: ctx.options.timeoutMs,
        }),
      })

      const configFallback = await runCli(cli, ['deploy', '--json'])
      expect(parseJsonOutput(configFallback.stdout)).toEqual({
        baseUrl: 'https://api.example.test',
        baseUrlSource: 'project-file',
        looseSource: 'default',
        org: 'org_config',
        orgSource: 'project-config',
        timeoutMs: 2500,
      })

      const argv = await runCli(cli, ['deploy', '--org', 'org_argv', '--json'])
      expect(parseJsonOutput(argv.stdout).orgSource).toBe('argv')
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('validates command env from the supplied serve env', async () => {
    const cli = Cli.create('app').command('token', {
      env: z.object({ TOKEN: z.string() }),
      run: ({ env }) => ({ token: env.TOKEN }),
    })

    const result = await runCli(cli, ['token', '--json'], { env: { TOKEN: 'secret' } })
    expect(parseJsonOutput(result.stdout)).toEqual({ token: 'secret' })
  })

  test('returns a validation error when required env is missing', async () => {
    const cli = Cli.create('app').command('token', {
      env: z.object({ TOKEN: z.string() }),
      run: ({ env }) => ({ token: env.TOKEN }),
    })

    const result = await runCli(cli, ['token', '--json'], { env: {} })
    expect(result.exitCode).toBe(1)
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [{ path: '$.TOKEN' }],
    })
  })

  test('runs middleware around command handlers and exposes vars', async () => {
    const cli = Cli.create('app', {
      vars: z.object({ trace: z.array(z.string()).default([]) }),
    })
      .use(middleware(async (ctx, next) => {
        ;(ctx.var['trace'] as string[]).push('before')
        await next()
        ;(ctx.var['trace'] as string[]).push('after')
      }))
      .command('trace', {
        run: ({ var: vars }) => {
          ;(vars['trace'] as string[]).push('run')
          return { trace: vars['trace'] }
        },
      })

    const result = await runCli(cli, ['trace', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ trace: ['before', 'run', 'after'] })
  })
})

describe('contract: fetch and schema', () => {
  test('fetch dispatches HTTP paths to commands and returns an envelope', async () => {
    const cli = Cli.create('api').command('users', {
      args: z.object({ id: z.coerce.number() }),
      options: z.object({ active: z.coerce.boolean().default(false), limit: z.coerce.number().default(10) }),
      run: ({ args, options }) => ({ active: options.active, id: args.id, limit: options.limit }),
    })

    const response = await cli.fetch(new Request('http://localhost/users/7?active=true&limit=3'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { active: true, id: 7, limit: 3 } })
  })

  test('fetch dispatch merges JSON body options and normalizes not found and validation errors', async () => {
    const cli = Cli.create('api').command('users', {
      args: z.object({ id: z.coerce.number() }),
      options: z.object({ active: z.boolean(), limit: z.number() }),
      run: ({ args, options }) => ({ id: args.id, options }),
    })

    const response = await cli.fetch(
      new Request('http://localhost/users/7', {
        body: JSON.stringify({ active: false, limit: 5 }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { id: 7, options: { active: false, limit: 5 } } })

    const missing = await cli.fetch(new Request('http://localhost/missing'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ ok: false, error: { code: 'COMMAND_NOT_FOUND' } })

    const invalid = await cli.fetch(new Request('http://localhost/users/not-a-number?active=true&limit=5'))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })

  test('fetch exposes MCP endpoint, HEAD behavior, and invalid JSON fallback', async () => {
    const cli = Cli.create('api', { version: '3.0.0' }).command('echo', {
      options: z.object({ message: z.string().default('empty') }),
      run: ({ options }) => ({ message: options.message }),
    })

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
    expect(await invalidJson.json()).toEqual({ ok: true, data: { message: 'empty' } })
  })

  test('schema output is generated from Zod, not hand-written fixtures', async () => {
    const cli = Cli.create('app').command('ship', {
      args: z.object({ version: z.string().describe('release version') }),
      options: z.object({ dryRun: z.boolean().default(false).describe('do not publish') }),
      run: () => ({ ok: true }),
    })

    const result = await runCli(cli, ['ship', '--schema', '--json'])
    const schema = parseJsonOutput(result.stdout)
    expect(schema.args.properties.version.description).toBe('release version')
    expect(schema.options.properties.dryRun.description).toBe('do not publish')
  })

  test('output validation rejects handler results that do not match the output schema', async () => {
    const cli = Cli.create('app').command('ship', {
      output: z.object({ id: z.number() }),
      run: () => ({ id: 'not-a-number' }),
    })

    const result = await runCli(cli, ['ship', '--json'])
    expect(result.exitCode).toBe(1)
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [{ path: '$.id' }],
    })
  })
})

describe('contract: mcp, completions, and token behavior', () => {
  test('mcp initialize, tools/list, tools/call, and unknown method use JSON-RPC envelopes', async () => {
    const cli = Cli.create('app', { version: '1.2.3' }).command('echo', {
      args: z.object({ message: z.string() }),
      run: ({ args }) => ({ message: args.message }),
    })
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
    const cli = Cli.create('app')
      .command('inspect', { aliases: ['i'], run: () => ({ ok: true }) })
      .command('install', { run: () => ({ ok: true }) })
    const state = (cli as InternalCli)[stateSymbol]

    expect(Completions.complete(state, ['i'], 0)).toEqual(['inspect', 'install', 'i'])
  })

  test('completion requests are served through the public CLI path', async () => {
    const cli = Cli.create('app')
      .command('inspect', { aliases: ['i'], run: () => ({ ok: true }) })
      .command('install', { run: () => ({ ok: true }) })

    const result = await runCli(cli, ['--', 'i'], { env: { COMPLETE: 'bash' } })
    expect(result.stdout.trim().split('\n')).toEqual(['inspect', 'install', 'i'])
    expect(result.stderr).toBe('')
  })

  test('completion requests include top-level builtins', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({ ok: true }) })

    const result = await runCli(cli, ['--'], { env: { COMPLETE: 'bash' } })
    expect(result.stdout.trim().split('\n')).toEqual(['run', 'completions'])
  })

  test('agent helper builtins are opt-in through public CLI behavior', async () => {
    const cli = Cli.create('app', { builtins: { mcp: true, skills: true } })
      .command('list', { run: () => ({ command: 'list' }) })
      .command('add', { run: () => ({ command: 'add' }) })

    const list = await runCli(cli, ['skills', 'list', '--json'])
    expect(parseJsonOutput(list.stdout)).toEqual({ skills: [{ installed: false, name: 'app' }] })

    const plainList = await runCli(cli, ['list', '--json'])
    expect(parseJsonOutput(plainList.stdout)).toEqual({ command: 'list' })

    const plainAdd = await runCli(cli, ['add', '--json'])
    expect(parseJsonOutput(plainAdd.stdout)).toEqual({ command: 'add' })

    const defaultCompletions = await runCli(cli, ['completions'])
    expect(defaultCompletions.stdout).toContain('COMPLETE=bash app --')

    const completions = await runCli(cli, ['completions', 'zsh'])
    expect(completions.stdout).toContain('COMPLETE=zsh app --')

    const badShell = await runCli(cli, ['completions', 'powershell'])
    expect(badShell.stdout).toBe('')
    expect(badShell.stderr).toContain("Unknown shell 'powershell'")

    const skillsHelp = await runCli(cli, ['skills', '--help'])
    expect(skillsHelp.stdout).toBe('  app skills add  Sync skill file\n  app skills list  List available skills\n')

    const mcpHelp = await runCli(cli, ['mcp'])
    expect(mcpHelp.stdout).toBe('  app mcp add  Register MCP server config\n')
  })

  test('agent helper builtins are not available unless enabled', async () => {
    const cli = Cli.create('app').command('list', { run: () => ({ command: 'list' }) })

    const skills = await runCli(cli, ['skills', 'list', '--json'])
    expect(skills.stdout).toContain('Usage: app <command>')
    expect(skills.stdout).not.toContain('skills list')
  })

  test('config can expose config doctor without unrelated helper builtins', async () => {
    const configured = Cli.create('app', { config: Config.object({}) }).command('list', { run: () => ({ command: 'list' }) })

    const help = await runCli(configured, ['--help'])
    expect(help.stdout).toContain('config doctor')
    expect(help.stdout).not.toContain('mcp add')
    expect(help.stdout).not.toContain('skills add')

    const doctor = await runCli(configured, ['config', 'doctor', '--json'])
    expect(parseJsonOutput(doctor.stdout)).toEqual({
      config: { enabled: true, loaded: true, keys: [] },
    })

    const minimal = Cli.create('minimal').command('list', { run: () => ({ command: 'list' }) })
    const minimalHelp = await runCli(minimal, ['--help'])
    expect(minimalHelp.stdout).not.toContain('config doctor')
    expect(minimalHelp.stdout).not.toContain('mcp add')
    expect(minimalHelp.stdout).not.toContain('skills add')
  })

  test('serve handles version, full output, filters, token limits, and CTA metadata', async () => {
    const cli = Cli.create('app', { version: '2.0.0' }).command('deploy', {
      run: ({ ok }) =>
        ok(
          { nested: { keep: 'yes', skip: 'no' }, status: 'ready' },
          { cta: { commands: [{ command: 'status', options: { verbose: true } }], description: 'Next:' } },
        ),
    })

    const version = await runCli(cli, ['--version'])
    expect(version.stdout).toBe('2.0.0\n')

    const full = await runCli(cli, ['deploy', '--json', '--full-output'])
    expect(parseJsonOutput(full.stdout)).toEqual({
      data: { nested: { keep: 'yes', skip: 'no' }, status: 'ready' },
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

  test('serve handles completion errors, empty completions, default version, and MCP mode', async () => {
    const cli = Cli.create('app')

    const badCompletion = await runCli(cli, ['--'], { env: { COMPLETE: 'powershell' } })
    expect(badCompletion.stdout).toBe('')
    expect(badCompletion.stderr).toContain("Unknown completion shell 'powershell'. Supported: bash, zsh, fish")

    const emptyCompletion = await runCli(cli, ['run', 'nested', ''], { env: { COMPLETE: 'bash' } })
    expect(emptyCompletion.stdout).toBe('')

    const version = await runCli(cli, ['--version'])
    expect(version.stdout).toBe('0.0.0\n')
  })

  test('serve honors agent-only output policy unless full output is requested', async () => {
    const cli = Cli.create('app').command('quiet', {
      outputPolicy: 'agent-only',
      run: () => ({ hidden: true }),
    })

    const normal = await runCli(cli, ['quiet', '--json'])
    expect(normal.stdout).toBe('{\n  "hidden": true\n}\n')

    const full = await runCli(cli, ['quiet', '--json', '--full-output'])
    expect(parseJsonOutput(full.stdout)).toEqual({ ok: true, data: { hidden: true } })
  })

  test('serve normalizes ctx.error exit codes and command-not-runnable errors', async () => {
    const cli = Cli.create('app')
      .command('fail', {
        run: ({ error }) => error({ code: 'NOPE', exitCode: 7, message: 'failed', retryable: true }),
      })
      .command('empty', {})

    const fail = await runCli(cli, ['fail', '--json'])
    expect(fail.exitCode).toBe(7)
    expect(parseJsonOutput(fail.stdout)).toMatchObject({ code: 'NOPE', exitCode: 7, message: 'failed', retryable: true })

    const empty = await runCli(cli, ['empty', '--json'])
    expect(empty.exitCode).toBe(1)
    expect(parseJsonOutput(empty.stdout)).toMatchObject({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no run handler' })
  })

  test('token count and token limit use tokenx semantics instead of character length', () => {
    const text = 'alpha beta gamma delta'

    expect(Formatter.tokenCount(text)).toBeLessThan(text.length)
    expect(Formatter.tokenSlice(text, 0, 2)).toContain('[truncated: showing tokens 0-2')
  })
})

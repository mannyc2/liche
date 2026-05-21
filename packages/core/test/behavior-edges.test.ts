import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli, Config, Formatter, z } from '../src/index.js'
import * as Fetch from '../src/fetch/index.js'
import * as Mcp from '../src/mcp/index.js'
import * as Parser from '../src/parser/index.js'
import * as Schema from '../src/schema/index.js'
import * as Skill from '../src/skills/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { builtinHelpLines, builtinSuggestions } from '../src/cli/builtin-metadata.js'
import { camel, collectAsync, isAsyncIterable, isObject, kebab } from '../src/internal.js'
import { handleMcpHttp } from '../src/mcp/http.js'
import { childCommands, collectCommands, commandScope, completionCommands, outputPolicy, selectCommand } from '../src/command/registry.js'
import { isAlias, isFetch, isGroup, isResult } from '../src/command/guards.js'

describe('fetch command proxy behavior', () => {
  test('parseCurl preserves method, headers, JSON body, and path segments', () => {
    const parsed = Fetch.parseCurl(['users', '7', '-X', 'patch', '-H', 'X-Trace: abc:def', '--data', '{"ok":true}'])

    expect(parsed.method).toBe('PATCH')
    expect(parsed.path).toEqual(['users', '7'])
    expect(parsed.headers.get('x-trace')).toBe('abc:def')
    expect(parsed.headers.get('content-type')).toBe('application/json')
    expect(parsed.body).toBe('{"ok":true}')
  })

  test('parseCurl accepts curl aliases and trims path, method, body, and header forms', () => {
    const requestAlias = Fetch.parseCurl(['--request', 'put', '--header', ' X-Name : Ada ', '--body', 'payload'])
    expect(requestAlias.method).toBe('PUT')
    expect(requestAlias.body).toBe('payload')
    expect(requestAlias.headers.get('x-name')).toBe('Ada')

    const methodAlias = Fetch.parseCurl(['--method', 'delete', '-d', '{}'])
    expect(methodAlias.method).toBe('DELETE')

    const bodyDefaultsPost = Fetch.parseCurl(['-d', '{"created":true}'])
    expect(bodyDefaultsPost.method).toBe('POST')
    expect(bodyDefaultsPost.headers.get('content-type')).toBe('application/json')
  })

  test('callFetch joins base paths and normalizes text and JSON responses', async () => {
    const seen: string[] = []
    const json = await Fetch.callFetch(
      {
        _fetch: true,
        basePath: '//v1/',
        fetch: async (request) => {
          seen.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('authorization')}`)
          return Response.json({ ok: true })
        },
      },
      ['users', '-H', 'Authorization: Bearer token'],
    )

    expect(seen).toEqual(['GET /v1/users Bearer token'])
    expect(json).toEqual({ ok: true, data: { ok: true } })

    const text = await Fetch.callFetch(
      {
        _fetch: true,
        fetch: async () => new Response('nope', { status: 418 }),
      },
      [],
    )
    expect(text).toEqual({ ok: false, error: { code: 'FETCH_ERROR', message: 'nope', status: 418 } })

    const objectError = await Fetch.callFetch(
      {
        _fetch: true,
        fetch: async () => Response.json({ reason: 'bad' }, { status: 400 }),
      },
      [],
    )
    expect(objectError).toEqual({ ok: false, error: { code: 'FETCH_ERROR', message: '{"reason":"bad"}', status: 400 } })
  })

  test('fetch ignores request bodies for GET and HEAD', async () => {
    const cli = Cli.create('api').command('echo', {
      options: z.object({ message: z.string().default('empty') }),
      run: ({ options }) => options,
    })

    const getWithBody = await cli.fetch(new Request('http://localhost/echo?message=query', { method: 'GET' }))
    expect(await getWithBody.json()).toEqual({ ok: true, data: { message: 'query' } })

    const headWithBody = await cli.fetch(new Request('http://localhost/echo?message=head', { method: 'HEAD' }))
    expect(headWithBody.status).toBe(200)
  })

  test('fetch envelopes preserve not-found messages, body parsing fallback, and explicit JSON format context', async () => {
    const cli = Cli.create('api').command('ctx', {
      options: z.object({ message: z.string().default('empty') }),
      run: ({ format, formatExplicit, options }) => ({ format, formatExplicit, message: options.message }),
    })

    const missing = await cli.fetch(new Request('http://localhost/nope'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ ok: false, error: { code: 'COMMAND_NOT_FOUND', message: 'No command for /nope' } })

    const invalidBody = await cli.fetch(new Request('http://localhost/ctx?message=query', { body: 'not json', method: 'POST' }))
    expect(await invalidBody.json()).toEqual({ ok: true, data: { format: 'json', formatExplicit: true, message: 'query' } })

    const body = await cli.fetch(new Request('http://localhost/ctx', { body: '{"message":"body"}', method: 'POST' }))
    expect(await body.json()).toEqual({ ok: true, data: { format: 'json', formatExplicit: true, message: 'body' } })
  })
})

describe('format, filter, CTA, and schema behavior', () => {
  test('pick supports object paths, array indices, multiple paths, and invalid paths', () => {
    const data = {
      meta: { count: 2 },
      users: [
        { id: 1, profile: { name: 'Ada' } },
        { id: 2, profile: { name: 'Grace' } },
      ],
    }

    expect(Formatter.pick(data, 'users[0,1].profile.name, meta.count')).toEqual({
      meta: { count: 2 },
      users: [{ profile: { name: 'Ada' } }, { profile: { name: 'Grace' } }],
    })
    expect(Formatter.pick(data, 'users[9].id')).toEqual({ users: [{ id: undefined }] })
    expect(Formatter.pick(data, 'bad[')).toBeUndefined()
  })

  test('CTA formatting preserves args, kebab-case options, booleans, and descriptions', () => {
    expect(
      Formatter.formatCta('ship', {
        commands: [
          'status',
          {
            args: { tag: 'v1.0.0' },
            command: 'publish',
            description: 'publish release',
            options: { dryRun: true, maxRetries: 2 },
          },
        ],
        description: 'Next steps:',
      }),
    ).toBe('Next steps:\n  ship status\n  ship publish v1.0.0 --dry-run --max-retries 2 - publish release\n')
  })

  test('schema adapter applies defaults and normalizes validation errors', () => {
    const schema = z.object({
      enabled: z.boolean().default(true),
      name: z.string(),
      nested: z.object({ count: z.number() }).optional(),
    })

    expect(Schema.parseSchema(schema, { name: 'Ada' })).toEqual({ enabled: true, name: 'Ada' })
    expect(Schema.objectShape(schema)).toHaveProperty('nested')
    expect(Schema.isOptional(Schema.objectShape(schema)['nested'])).toBe(true)

    try {
      Schema.parseSchema(schema, { name: 1, nested: { count: 'x' } })
      throw new Error('expected validation to fail')
    } catch (error) {
      expect(error).toMatchObject({
        fieldErrors: [{ path: '$.name' }, { path: '$.nested.count' }],
        message: 'Validation failed',
      })
    }
  })

  test('schema adapter reports shape, descriptions, optional wrappers, and root validation paths', () => {
    const wrapped = z.string().optional().nullable().describe('wrapped value')
    const schema = z.object({ wrapped })

    expect(Schema.toJsonSchema(schema)).toMatchObject({ type: 'object', properties: { wrapped: { description: 'wrapped value' } } })
    expect(Schema.objectShape(undefined)).toEqual({})
    expect(Schema.isObjectSchema(schema)).toBe(true)
    expect(Schema.isObjectSchema(wrapped)).toBe(false)
    expect(Schema.isBooleanSchema(z.boolean().default(false))).toBe(true)
    expect(Schema.description(wrapped)).toBe('wrapped value')
    expect(Schema.kind(wrapped)).toBe('nullable')

    try {
      Schema.parseSchema(z.string(), 12)
      throw new Error('expected root validation to fail')
    } catch (error) {
      expect(error).toMatchObject({ fieldErrors: [{ path: '$' }], message: 'Validation failed' })
    }
  })

  test('formatters and token helpers preserve output modes and unbounded slices', () => {
    expect(Formatter.format({ ok: true }, 'json')).toBe('{\n  "ok": true\n}')
    expect(Formatter.format([{ id: 1 }, { id: 2 }], 'jsonl')).toBe('{"id":1}\n{"id":2}')
    expect(Formatter.format('plain', 'md')).toBe('plain')
    expect(Formatter.format({ ok: true }, 'md')).toBe('```json\n{\n  "ok": true\n}\n```')
    expect(Formatter.format({ ok: true }, 'yaml')).toBe('ok: true')
    expect(Formatter.tokenSlice('alpha beta gamma', 1)).not.toContain('[truncated:')
    expect(Formatter.tokenSlice('alpha beta gamma', 0, 99)).not.toContain('[truncated:')
  })
})

describe('runtime and config behavior', () => {
  test('loadConfig reads JSON, YAML, explicit paths, and disabled config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lili-config-'))
    const jsonPath = join(root, 'app.json')
    const yamlPath = join(root, 'app.yaml')
    await Bun.write(jsonPath, JSON.stringify({ mode: 'json' }))
    await Bun.write(yamlPath, 'mode: yaml\n')

    try {
      const jsonCli = Cli.create('app', { config: Config.object({ files: [jsonPath] }) })
      const yamlCli = Cli.create('app', { config: Config.object({ files: [yamlPath] }) })

      expect(await Parser.loadConfig('app', (jsonCli as InternalCli)[stateSymbol], { rest: [] })).toEqual({
        mode: 'json',
      })
      expect(await Parser.loadConfig('app', (yamlCli as InternalCli)[stateSymbol], { rest: [] })).toEqual({
        mode: 'yaml',
      })
      expect(await Parser.loadConfig('app', (jsonCli as InternalCli)[stateSymbol], { configDisabled: true, rest: [] })).toBeUndefined()
      expect(await Parser.loadConfig('app', (jsonCli as InternalCli)[stateSymbol], { configPath: jsonPath, rest: [] })).toEqual({
        mode: 'json',
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('command registry and guards behavior', () => {
  test('guards distinguish aliases, groups, fetch entries, and result envelopes', () => {
    expect(isAlias({ _alias: true, target: 'run' })).toBe(true)
    expect(isAlias(undefined)).toBe(false)
    expect(isAlias({ _alias: false, target: 'run' })).toBe(false)
    expect(isGroup({ _group: true, commands: new Map(), middlewares: [], name: 'admin' })).toBe(true)
    expect(isGroup(null)).toBe(false)
    expect(isFetch({ _fetch: true, fetch: async () => new Response() })).toBe(true)
    expect(isFetch('fetch')).toBe(false)
    expect(isResult({ ok: true, data: 1 })).toBe(true)
    expect(isResult({ ok: 'true' })).toBe(false)
    expect(isResult(null)).toBe(false)
  })

  test('registry scopes aliases, group roots, completions, policies, and collected command names', () => {
    const admin = Cli.create('admin', {
      description: 'admin root',
      outputPolicy: 'agent-only',
      run: () => ({ root: true }),
    })
      .command('audit', { aliases: ['a'], description: 'audit logs', run: () => ({ ok: true }) })
      .command('remote', { fetch: async () => Response.json({ ok: true }) })
    const cli = Cli.create('app', { description: 'root app' }).command(admin)
    const state = (cli as InternalCli)[stateSymbol]

    const rootScope = commandScope(state)
    expect(rootScope.description).toBe('root app')
    expect(childCommands(rootScope).map((command) => command.name)).toEqual(['admin'])

    const groupScope = commandScope(state, ['admin'])
    expect(groupScope.description).toBe('admin root')
    expect(childCommands(groupScope).map((command) => [command.name, command.aliases])).toEqual([
      ['audit', ['a']],
      ['remote', []],
    ])

    const selectedAlias = selectCommand(state, ['admin', 'a', 'tail'])
    expect(selectedAlias?.path).toEqual(['admin', 'audit'])
    expect(selectedAlias?.argv.args).toEqual(['tail'])
    expect(outputPolicy(selectCommand(state, ['admin'])!)).toBe('agent-only')

    expect(completionCommands(state, ['admin', 'a'])).toEqual(['audit', 'a'])
    expect(completionCommands(state, ['admin', 'audit', 'x'])).toEqual([])
    expect(collectCommands(state.commands, state.root).map((command) => command.name)).toEqual(['admin', 'admin audit', 'admin remote'])
  })
})

describe('builtin metadata and skill sync behavior', () => {
  test('builtin metadata drives opt-in help and nested completion suggestions', () => {
    expect(builtinSuggestions([''])).toEqual(['completions'])
    const allBuiltins = { gen: true, mcp: true, skills: true }
    expect(builtinSuggestions([''], allBuiltins)).toEqual(['completions', 'gen', 'mcp', 'skills'])
    expect(builtinSuggestions(['m'], allBuiltins)).toEqual(['mcp'])
    expect(builtinSuggestions(['skills', ''], allBuiltins)).toEqual(['add', 'list'])
    expect(builtinSuggestions(['mcp', 'a'], allBuiltins)).toEqual(['add'])
    expect(builtinSuggestions(['mcp', 'add', ''], allBuiltins)).toEqual([])
    expect(builtinSuggestions(['run', ''])).toEqual([])

    expect(builtinHelpLines()).toEqual([
      '  completions  Generate shell completion script',
    ])
    expect(builtinHelpLines(allBuiltins)).toEqual([
      '  completions  Generate shell completion script',
      '  gen          Generate typed Cli.Commands declarations',
      '  mcp add      Register MCP server config',
      '  skills add   Sync skill file',
      '  skills list  List available skills',
    ])
  })

  test('skill markdown and index preserve frontmatter, descriptions, root commands, and command examples', () => {
    const cli = Cli.create('ship', {
      description: 'release helper',
      run: () => ({ ok: true }),
    }).command('publish', {
      description: 'publish a release',
      run: () => ({ ok: true }),
    })
    const state = (cli as InternalCli)[stateSymbol]

    expect(Skill.skillIndex('ship', state)).toBe('# ship\nrelease helper\n\n- (root): release helper\n- publish: publish a release')
    expect(Skill.skillMarkdown('ship', state)).toContain('---\nname: ship\ndescription: release helper\n---')
    expect(Skill.skillMarkdown('ship', state)).toContain('# ship\n\nrelease helper\n\n## Commands')
    expect(Skill.skillMarkdown('ship', state)).toContain('### (root)\nrelease helper\n\n`$ ship`')
    expect(Skill.skillMarkdown('ship', state)).toContain('### publish\npublish a release\n\n`$ ship publish`')

    const unnamed = Cli.create('tool').command('run', { run: () => ({ ok: true }) })
    const unnamedState = (unnamed as InternalCli)[stateSymbol]
    expect(Skill.skillMarkdown('tool', unnamedState)).toContain('description: tool CLI')
    expect(Skill.skillIndex('tool', unnamedState)).toContain('- run: ')
  })

  test('skills add and mcp add write expected files under isolated HOME', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lili-sync-'))
    const previousHome = Bun.env['HOME']
    Bun.env['HOME'] = root

    try {
      const cli = Cli.create('ship', { builtins: { mcp: true, skills: true }, description: 'release helper', mcp: { command: 'ship-cli' } }).command('publish', {
        description: 'publish a release',
        run: () => ({ ok: true }),
      })

      const skill = await runCliWithLocalImport(cli, ['skills', 'add'])
      const skillPath = join(root, '.claude/skills/ship/SKILL.md')
      expect(skill.stdout).toBe(`wrote ${skillPath}\n`)
      expect(await Bun.file(skillPath).text()).toContain('### publish\npublish a release')

      const mcp = await runCliWithLocalImport(cli, ['mcp', 'add'])
      const mcpPath = join(root, '.config/lili/mcp/ship.json')
      expect(mcp.stdout).toBe(`wrote ${mcpPath}\n`)
      expect(await Bun.file(mcpPath).json()).toEqual({ mcpServers: { ship: { args: ['--mcp'], command: 'ship-cli' } } })
    } finally {
      if (previousHome === undefined) delete Bun.env['HOME']
      else Bun.env['HOME'] = previousHome
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('parser globals and internal helpers', () => {
  test('parseGlobals recognizes value flags, booleans, config flags, and rest args', () => {
    expect(
      Parser.parseGlobals(
        [
          '--json',
          '--format=yaml',
          '--full-output',
          '--filter-output',
          'data.id',
          '--llms',
          '--mcp',
          '--schema',
          '--token-count',
          '--token-limit=10',
          '--token-offset',
          '2',
          '--config',
          'app.yaml',
          '--no-config',
          '--version',
          '-h',
          'run',
        ],
        'config',
      ),
    ).toEqual({
      configDisabled: true,
      configPath: 'app.yaml',
      filterOutput: 'data.id',
      format: 'yaml',
      formatExplicit: true,
      fullOutput: true,
      help: true,
      json: true,
      llms: true,
      mcp: true,
      rest: ['run'],
      schema: true,
      tokenCount: true,
      tokenLimit: 10,
      tokenOffset: 2,
      version: true,
    })
  })

  test('parseGlobals throws ParseError on invalid format value', () => {
    expect(() => Parser.parseGlobals(['--format', 'bogus'])).toThrow(/Invalid format/)
  })

  test('parseGlobals throws ParseError on non-numeric --token-limit', () => {
    expect(() => Parser.parseGlobals(['--token-limit', 'abc'])).toThrow(/Invalid value for --token-limit/)
  })

  test('parseGlobals throws ParseError when value flag is missing its value', () => {
    expect(() => Parser.parseGlobals(['--format'])).toThrow(/Missing value for flag: --format/)
  })

  test('parseGlobals throws ParseError on --format= with empty value', () => {
    expect(() => Parser.parseGlobals(['--format='])).toThrow(/Missing value for flag: --format/)
  })

  test('internal string, object, and async iterable helpers preserve their contracts', async () => {
    expect(camel('dry-run-now')).toBe('dryRunNow')
    expect(kebab('dryRunNow')).toBe('dry-run-now')
    expect(isObject({ ok: true })).toBe(true)
    expect(isObject([])).toBe(false)
    expect(isObject(null)).toBe(false)

    async function* values() {
      yield 'a'
      yield 'b'
    }

    const iterable = values()
    expect(isAsyncIterable(iterable)).toBe(true)
    expect(isAsyncIterable({})).toBe(false)
    expect(await collectAsync(iterable)).toEqual(['a', 'b'])
  })

  test('MCP HTTP handler wraps protocol responses as JSON', async () => {
    const cli = Cli.create('app', { version: '1.0.0' })
    const response = await handleMcpHttp('app', (cli as InternalCli)[stateSymbol], new Request('http://localhost/mcp', {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      method: 'POST',
    }))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ id: 1, result: { serverInfo: { name: 'app', version: '1.0.0' } } })
  })

  test('MCP protocol exposes root tools, tool schemas, error content, and missing tool envelopes', async () => {
    const cli = Cli.create('app', {
      description: 'root tool',
      options: z.object({ shout: z.boolean().default(false) }),
      run: ({ options }) => ({ shout: options.shout }),
    }).command('fail', {
      run: ({ error }) => error({ code: 'FAIL', message: 'nope' }),
    })
    const state = (cli as InternalCli)[stateSymbol]

    const tools = (await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as any
    expect(tools.result.tools).toMatchObject([
      { description: 'root tool', inputSchema: { type: 'object' }, name: '(root)' },
      { name: 'fail' },
    ])

    const rootCall = (await Mcp.mcpMessage('app', state, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: '(root)', arguments: { options: { shout: true } } },
    })) as any
    expect(rootCall.result).toEqual({ content: [{ text: '{"shout":true}', type: 'text' }], isError: false })

    const failed = (await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fail' } })) as any
    expect(failed.result.isError).toBe(true)
    expect(JSON.parse(failed.result.content[0].text)).toMatchObject({ code: 'FAIL', message: 'nope' })

    const missing = (await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'missing' } })) as any
    expect(missing.result).toEqual({
      content: [{ text: '{"code":"COMMAND_NOT_FOUND","message":"No tool missing"}', type: 'text' }],
      isError: true,
    })
  })
})

async function runCliWithLocalImport(cli: ReturnType<typeof Cli.create>, argv: string[]) {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await cli.serve(argv, {
    exit(code) {
      exitCode = code
    },
    stderr(chunk) {
      stderr += chunk
    },
    stdout(chunk) {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}

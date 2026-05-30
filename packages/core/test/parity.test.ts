import { describe, expect, test } from 'bun:test'
import { middleware, z } from '../src/index.js'
import { parseJsonData, parseJsonOutput, runCli, testCli, testCommand } from './helpers.js'
import { manifestEnvelope, mcpToolName } from '../src/command/registry.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import * as Mcp from '@liche/mcp-server'
import { skillsRuntime } from '@liche/skills-runtime'

// Sources: https://github.com/wevm/incur (README.md, SKILL.md)
// All expected behaviors below are quoted in the plan and derived from upstream incur.

describe('parity: streaming async generators', () => {
  test('each yield writes one stdout line in jsonl mode, followed by the result envelope', async () => {
    const cli = testCli('app', [testCommand('stream', {
      run: async function* () {
        yield { step: 1 }
        yield { step: 2 }
        yield { step: 3 }
      },
    })])

    const result = await runCli(cli, ['stream', '--format', 'jsonl'])
    const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.length).toBe(4)
    expect(lines.slice(0, 3)).toEqual([
      { type: 'chunk', data: { step: 1 } },
      { type: 'chunk', data: { step: 2 } },
      { type: 'chunk', data: { step: 3 } },
    ])
    expect(lines[3]).toMatchObject({ ok: true, data: [{ step: 1 }, { step: 2 }, { step: 3 }], error: null })
  })

  test('NDJSON streaming over fetch when accept header opts in', async () => {
    const cli = testCli('api', [testCommand('stream', {
      run: async function* () {
        yield { step: 1 }
        yield { step: 2 }
      },
    })])
    const response = await cli.fetch(
      new Request('http://localhost/stream', { headers: { accept: 'application/x-ndjson' } }),
    )
    expect(response.headers.get('content-type')).toBe('application/x-ndjson')
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines[0]).toEqual({ type: 'chunk', data: { step: 1 } })
    expect(lines[1]).toEqual({ type: 'chunk', data: { step: 2 } })
    expect(lines[2]).toMatchObject({ ok: true, data: [{ step: 1 }, { step: 2 }], error: null })
  })
})

describe('parity: deprecated option metadata', () => {
  test('manifest schema captures deprecated keys', async () => {
    const cli = testCli('app', [testCommand('build', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({ ok: true }),
    })])
    const result = await runCli(cli, ['build', '--schema', '--json'])
    expect(parseJsonOutput(result.stdout)).toMatchObject({ deprecated: ['legacy'] })
  })

  test('--help shows [deprecated] suffix on the option row', async () => {
    const cli = testCli('app', [testCommand('build', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({ ok: true }),
    })])
    const result = await runCli(cli, ['build', '--help'])
    expect(result.stdout).toContain('--legacy')
    expect(result.stdout).toContain('[deprecated]')
  })

  test('deprecation warning fires on TTY only', async () => {
    const cli = testCli('app', [testCommand('build', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({ done: true }),
    })])

    const piped = await runCli(cli, ['build', '--legacy', '--json'], { streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
    expect(piped.stderr).toBe('')

    const tty = await runCli(cli, ['build', '--legacy', '--json'], { streams: { stdin: 'tty', stdout: 'tty', stderr: 'tty' } })
    expect(tty.stderr).toContain('warning: --legacy is deprecated')
  })
})

describe('parity: MCP tool naming uses underscores', () => {
  test('mcpToolName flattens whitespace', () => {
    expect(mcpToolName('pr list')).toBe('pr_list')
    expect(mcpToolName('pr view comments')).toBe('pr_view_comments')
    expect(mcpToolName('echo')).toBe('echo')
  })

  test('tools/list returns underscored names; tools/call accepts them', async () => {
    const cli = testCli('app', [
      testCommand(['pr', 'list'], { run: () => ({ ok: true }) }),
      testCommand(['pr', 'view'], { run: () => ({ ok: true }) }),
    ])
    const state = (cli as InternalCli)[stateSymbol]

    const list = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const tools = (list as any).result.tools.map((tool: any) => tool.name)
    expect(tools).toEqual(['pr_list', 'pr_view'])

    const call = await Mcp.mcpMessage('app', state, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'pr_list', arguments: {} },
    })
    expect((call as any).result.isError).toBe(false)
  })

  test('tools/call cannot invoke interactive commands', async () => {
    const cli = testCli('app', [
      testCommand('visible', { run: () => ({ ok: true }) }),
      testCommand('login', { interactive: true, run: () => ({ shouldNotRun: true }) }),
    ])
    const state = (cli as InternalCli)[stateSymbol]

    const list = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((list as any).result.tools.map((tool: any) => tool.name)).toEqual(['visible'])

    const call = await Mcp.mcpMessage('app', state, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'login', arguments: {} },
    })
    expect((call as any).result).toEqual({
      content: [{ text: '{"code":"COMMAND_NOT_FOUND","message":"No tool login"}', type: 'text' }],
      isError: true,
    })
  })
})

describe('parity: --json flips formatExplicit on a TTY', () => {
  test('formatExplicit is true when --json is passed on a TTY', async () => {
    const cli = testCli('app', [testCommand('show', {
      run: ({ formatExplicit, stdio }) => ({ formatExplicit, isTty: stdio.stdout.isTTY }),
    })])
    const result = await runCli(cli, ['show', '--json'], { streams: { stdin: 'tty', stdout: 'tty', stderr: 'tty' } })
    expect(parseJsonData(result.stdout)).toEqual({ formatExplicit: true, isTty: true })
  })

  test('formatExplicit is false on a TTY without an explicit format flag', async () => {
    const cli = testCli('app', [testCommand('show', {
      run: ({ formatExplicit }) => ({ formatExplicit }),
    })])
    const result = await runCli(cli, ['show'], { streams: { stdin: 'tty', stdout: 'tty', stderr: 'tty' } })
    expect(result.stdout).toContain('false')
  })
})

describe('parity: --llms shape', () => {
  test('--llms with --format json returns the liche.v1 envelope', async () => {
    const cli = testCli('app', { description: 'app cli', extensions: [skillsRuntime()], version: '1.0.0' }, [testCommand('publish', {
        description: 'ship a release',
        examples: ['app publish v1'],
        hint: 'idempotent with respect to the release tag',
        options: z.object({ dryRun: z.boolean().default(false) }),
        run: () => ({ ok: true }),
      })])
    const result = await runCli(cli, ['--llms', '--format', 'json'])
    const envelope = parseJsonOutput(result.stdout)
    expect(envelope.manifestVersion).toBe('liche.v1')
    expect(envelope.name).toBe('app')
    expect(envelope.commands[0]).toMatchObject({
      name: 'publish',
      description: 'ship a release',
      hint: 'idempotent with respect to the release tag',
      examples: ['app publish v1'],
    })
  })

  test('manifestEnvelope helper is callable directly', () => {
    const cli = testCli('app', [testCommand('echo', { run: () => ({}) })])
    const state = (cli as InternalCli)[stateSymbol]
    const envelope = manifestEnvelope('app', state)
    expect(envelope.manifestVersion).toBe('liche.v1')
    expect(envelope.commands.map((command) => command.name)).toEqual(['echo'])
  })

  test('manifest and MCP tools are derived from serializable command contracts without executing handlers', async () => {
    let executed = false
    const cli = testCli('app', [testCommand('danger', {
      description: 'contract only',
      options: z.object({ force: z.boolean().default(false) }),
      run: () => {
        executed = true
        throw new Error('manifest must not execute command handlers')
      },
    })])
    const state = (cli as InternalCli)[stateSymbol]

    const envelope = manifestEnvelope('app', state)
    const encoded = JSON.stringify(envelope)
    expect(executed).toBe(false)
    expect(encoded).toContain('"name":"danger"')
    expect(encoded).not.toContain('entry')
    expect(encoded).not.toContain('CliState')
    expect(encoded).not.toContain('run')

    const list = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(executed).toBe(false)
    expect((list as any).result.tools.map((tool: any) => tool.name)).toEqual(['danger'])
  })

  test('MCP tools include command output schemas when declared', async () => {
    const cli = testCli('app', [testCommand('status', {
      output: z.object({ ok: z.boolean() }),
      run: () => ({ ok: true }),
    })])
    const state = (cli as InternalCli)[stateSymbol]

    const list = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((list as any).result.tools[0].outputSchema.properties.ok.type).toBe('boolean')
  })
})

describe('parity: command hint and usage prefix/suffix', () => {
  test('hint renders after examples in --help', async () => {
    const cli = testCli('app', [testCommand('do', {
      description: 'do things',
      examples: ['app do thing'],
      hint: 'Tip: combine with --watch for live updates.',
      run: () => ({ ok: true }),
    })])
    const result = await runCli(cli, ['do', '--help'])
    const examplesIndex = result.stdout.indexOf('Examples:')
    const hintIndex = result.stdout.indexOf('Tip: combine')
    expect(examplesIndex).toBeGreaterThan(0)
    expect(hintIndex).toBeGreaterThan(examplesIndex)
  })

  test('usage prefix/suffix render around the binary line', async () => {
    const cli = testCli('curl.md', [testCommand('fetch', {
      args: z.object({ url: z.string() }),
      run: () => ({ ok: true }),
      usage: [{ args: { url: true }, prefix: 'cat file.txt | ', suffix: ' | head' }],
    })])
    const result = await runCli(cli, ['fetch', '--help'])
    expect(result.stdout).toContain('cat file.txt | curl.md fetch <url> | head')
  })
})

describe('parity: middleware-seeded vars', () => {
  test('middleware set() seeds vars read by the handler', async () => {
    const cli = testCli('app', {
      middleware: [middleware(async (ctx, next) => {
        ctx.set('tier', 'pro')
        await next()
      })],
    }, [testCommand('whoami', {
        run: ({ var: vars }) => ({ tier: vars['tier'] }),
      })])
    const result = await runCli(cli, ['whoami', '--json'])
    expect(parseJsonData(result.stdout)).toEqual({ tier: 'pro' })
  })
})

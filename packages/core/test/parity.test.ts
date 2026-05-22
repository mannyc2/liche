import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli, Config, middleware, z } from '../src/index.js'
import { parseJsonOutput, runCli } from './helpers.js'
import { renderTypegen } from '../src/command/typegen.js'
import { manifestEnvelope, mcpToolName } from '../src/command/registry.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import * as Mcp from '../src/mcp/index.js'

// Sources: https://github.com/wevm/incur (README.md, SKILL.md)
// All expected behaviors below are quoted in the plan and derived from upstream incur.

describe('parity: streaming async generators', () => {
  test('each yield writes one stdout line in jsonl mode', async () => {
    const cli = Cli.create('app').command('stream', {
      run: async function* () {
        yield { step: 1 }
        yield { step: 2 }
        yield { step: 3 }
      },
    })

    const result = await runCli(cli, ['stream', '--format', 'jsonl'])
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(3)
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: 'chunk', data: { step: 1 } },
      { type: 'chunk', data: { step: 2 } },
      { type: 'chunk', data: { step: 3 } },
    ])
  })

  test('NDJSON streaming over fetch when accept header opts in', async () => {
    const cli = Cli.create('api').command('stream', {
      run: async function* () {
        yield { step: 1 }
        yield { step: 2 }
      },
    })
    const response = await cli.fetch(
      new Request('http://localhost/stream', { headers: { accept: 'application/x-ndjson' } }),
    )
    expect(response.headers.get('content-type')).toBe('application/x-ndjson')
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines[0]).toEqual({ type: 'chunk', data: { step: 1 } })
    expect(lines[1]).toEqual({ type: 'chunk', data: { step: 2 } })
    expect(lines[2]).toMatchObject({ ok: true, data: [{ step: 1 }, { step: 2 }] })
  })
})

describe('parity: deprecated option metadata', () => {
  test('manifest schema captures deprecated keys', async () => {
    const cli = Cli.create('app').command('build', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({ ok: true }),
    })
    const result = await runCli(cli, ['build', '--schema', '--json'])
    expect(parseJsonOutput(result.stdout)).toMatchObject({ deprecated: ['legacy'] })
  })

  test('--help shows [deprecated] suffix on the option row', async () => {
    const cli = Cli.create('app').command('build', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({ ok: true }),
    })
    const result = await runCli(cli, ['build', '--help'])
    expect(result.stdout).toContain('--legacy')
    expect(result.stdout).toContain('[deprecated]')
  })

  test('deprecation warning fires on TTY only', async () => {
    const cli = Cli.create('app').command('build', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({ done: true }),
    })

    const piped = await runCli(cli, ['build', '--legacy', '--json'], { isTty: false })
    expect(piped.stderr).toBe('')

    const tty = await runCli(cli, ['build', '--legacy', '--json'], { isTty: true })
    expect(tty.stderr).toContain('warning: --legacy is deprecated')
  })
})

describe('parity: mcp add and skills add flag handling', () => {
  let home: string
  let cwd: string
  let originalCwd: string
  beforeEach(() => {
    originalCwd = process.cwd()
    home = realpathSync(mkdtempSync(join(tmpdir(), 'lili-mcp-')))
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lili-cwd-')))
  })
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(home, { force: true, recursive: true })
    rmSync(cwd, { force: true, recursive: true })
  })

  test('mcp add --agent claude-code writes ~/.claude.json by default', async () => {
    const cli = Cli.create('app', { builtins: { mcp: true } }).command('run', { run: () => ({ ok: true }) })
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code'], { env: { HOME: home } })
    expect(result.stdout.trim()).toBe(`wrote ${home}/.claude.json`)
    const config = await Bun.file(`${home}/.claude.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('mcp add --agent claude-code --no-global writes ./.mcp.json', async () => {
    const cli = Cli.create('app', { builtins: { mcp: true } }).command('run', { run: () => ({ ok: true }) })
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '--no-global'], { env: { HOME: home } })
    expect(result.stdout.trim()).toBe(`wrote ${cwd}/.mcp.json`)
    const config = await Bun.file(`${cwd}/.mcp.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('mcp add --command override is used as the spawn command', async () => {
    const cli = Cli.create('app', { builtins: { mcp: true } }).command('run', { run: () => ({ ok: true }) })
    process.chdir(cwd)
    await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '-c', 'bunx app-binary'], { env: { HOME: home } })
    const config = await Bun.file(`${home}/.claude.json`).json()
    expect(config.mcpServers.app.command).toBe('bunx app-binary')
  })

  test('skills add --agent cursor writes under ~/.cursor/skills', async () => {
    const cli = Cli.create('app', { builtins: { skills: true } }).command('run', { run: () => ({ ok: true }) })
    process.chdir(cwd)
    const result = await runCli(cli, ['skills', 'add', '--agent', 'cursor'], { env: { HOME: home } })
    expect(result.stdout.trim()).toBe(`wrote ${home}/.cursor/skills/app/SKILL.md`)
    expect(await Bun.file(`${home}/.cursor/skills/app/SKILL.md`).text()).toContain('# app')
  })

  test('skills add --json emits an envelope instead of plain text', async () => {
    const cli = Cli.create('app', { builtins: { skills: true } }).command('run', { run: () => ({ ok: true }) })
    process.chdir(cwd)
    const result = await runCli(cli, ['skills', 'add', '--agent', 'cursor', '--json'], { env: { HOME: home } })
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: { path: `${home}/.cursor/skills/app/SKILL.md` } })
  })

  test('mcp add --json emits an envelope instead of plain text', async () => {
    const cli = Cli.create('app', { builtins: { mcp: true } }).command('run', { run: () => ({ ok: true }) })
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: home } })
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: { path: `${home}/.claude.json` } })
  })
})

describe('parity: gen typegen built-in', () => {
  test('gen writes lili.generated.ts with Cli.Commands augmentation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'lili-gen-'))
    const originalCwd = process.cwd()
    process.chdir(cwd)
    try {
      const cli = Cli.create('app', { builtins: { gen: true } })
        .command('build', { args: z.object({ name: z.string() }), run: () => ({ ok: true }) })
        .command('publish', { run: () => ({ ok: true }) })

      const result = await runCli(cli, ['gen'])
      expect(result.stdout.trim()).toBe(`wrote ./lili.generated.ts`)
      const generated = await Bun.file(`${cwd}/lili.generated.ts`).text()
      expect(generated).toContain('declare module')
      expect(generated).toContain('"build"')
      expect(generated).toContain('"publish"')
    } finally {
      process.chdir(originalCwd)
      rmSync(cwd, { force: true, recursive: true })
    }
  })

  test('gen --json emits an envelope instead of plain text', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'lili-gen-'))
    const originalCwd = process.cwd()
    process.chdir(cwd)
    try {
      const cli = Cli.create('app', { builtins: { gen: true } }).command('build', { run: () => ({ ok: true }) })
      const result = await runCli(cli, ['gen', '--json'])
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: { path: './lili.generated.ts' } })
    } finally {
      process.chdir(originalCwd)
      rmSync(cwd, { force: true, recursive: true })
    }
  })

  test('renderTypegen output is deterministic', () => {
    const cli = Cli.create('app').command('a', { run: () => ({}) }).command('b', { run: () => ({}) })
    const state = (cli as InternalCli)[stateSymbol]
    const first = renderTypegen('app', state)
    const second = renderTypegen('app', state)
    expect(first).toBe(second)
  })

  test('renderTypegen produces exact output for a no-schema CLI', () => {
    const cli = Cli.create('app').command('a', { run: () => ({}) }).command('b', { run: () => ({}) })
    const state = (cli as InternalCli)[stateSymbol]
    expect(renderTypegen('app', state)).toMatchInlineSnapshot(`
"// Generated by \`app gen\`. Do not edit by hand.
// Re-run after changing command definitions.

declare module '@lili/core' {
  namespace Cli {
    interface Commands {
    "a": { args: undefined; options: undefined }
    "b": { args: undefined; options: undefined }
    }
  }
}

export {}
"
`)
  })

  test('renderTypegen embeds JSON schemas for args and options', () => {
    const cli = Cli.create('app').command('build', {
      args: z.object({ name: z.string() }),
      options: z.object({ dry: z.boolean().default(false) }),
      run: () => ({}),
    })
    const state = (cli as InternalCli)[stateSymbol]
    const out = renderTypegen('app', state)
    expect(out).toContain('"build": { args: {')
    expect(out).toContain('options: {')
    expect(out).not.toContain('args: undefined')
    expect(out).not.toContain('options: undefined')
  })

  test('renderTypegen header references the binary name verbatim', () => {
    const cli = Cli.create('mybin').command('a', { run: () => ({}) })
    const state = (cli as InternalCli)[stateSymbol]
    expect(renderTypegen('mybin', state).startsWith('// Generated by `mybin gen`. Do not edit by hand.\n')).toBe(true)
  })

  test('renderTypegen escapes */ inside embedded JSON', () => {
    const cli = Cli.create('app').command('build', {
      args: z.object({ name: z.string().describe('matches */ in regex') }),
      run: () => ({}),
    })
    const state = (cli as InternalCli)[stateSymbol]
    const out = renderTypegen('app', state)
    expect(out).not.toContain('matches */ in')
    expect(out).toContain('matches *\\/ in')
  })
})

describe('parity: MCP tool naming uses underscores', () => {
  test('mcpToolName flattens whitespace', () => {
    expect(mcpToolName('pr list')).toBe('pr_list')
    expect(mcpToolName('pr view comments')).toBe('pr_view_comments')
    expect(mcpToolName('echo')).toBe('echo')
  })

  test('tools/list returns underscored names; tools/call accepts them', async () => {
    const pr = Cli.create('pr').command('list', { run: () => ({ ok: true }) }).command('view', { run: () => ({ ok: true }) })
    const cli = Cli.create('app').command(pr)
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
})

describe('parity: --json flips agent on a TTY', () => {
  test('agent is true when explicit format is requested on a TTY', async () => {
    const cli = Cli.create('app').command('show', {
      run: ({ agent }) => ({ agent }),
    })
    const result = await runCli(cli, ['show', '--json'], { isTty: true })
    expect(parseJsonOutput(result.stdout)).toEqual({ agent: true })
  })

  test('agent is false on a TTY without explicit format', async () => {
    const cli = Cli.create('app').command('show', {
      run: ({ agent }) => ({ agent }),
    })
    const result = await runCli(cli, ['show'], { isTty: true })
    expect(result.stdout).toContain('false')
  })
})

describe('parity: --llms shape', () => {
  test('--llms with --format json returns the lili.v1 envelope', async () => {
    const cli = Cli.create('app', { description: 'app cli', version: '1.0.0' })
      .command('publish', {
        description: 'ship a release',
        examples: ['app publish v1'],
        hint: 'idempotent with respect to the release tag',
        options: z.object({ dryRun: z.boolean().default(false) }),
        run: () => ({ ok: true }),
      })
    const result = await runCli(cli, ['--llms', '--format', 'json'])
    const envelope = parseJsonOutput(result.stdout)
    expect(envelope.manifestVersion).toBe('lili.v1')
    expect(envelope.name).toBe('app')
    expect(envelope.commands[0]).toMatchObject({
      name: 'publish',
      description: 'ship a release',
      hint: 'idempotent with respect to the release tag',
      examples: ['app publish v1'],
    })
  })

  test('manifestEnvelope helper is callable directly', () => {
    const cli = Cli.create('app').command('echo', { run: () => ({}) })
    const state = (cli as InternalCli)[stateSymbol]
    const envelope = manifestEnvelope('app', state)
    expect(envelope.manifestVersion).toBe('lili.v1')
    expect(envelope.commands.map((command) => command.name)).toEqual(['echo'])
  })

  test('manifest and MCP tools are derived from serializable command contracts without executing handlers', async () => {
    let executed = false
    const cli = Cli.create('app').command('danger', {
      description: 'contract only',
      options: z.object({ force: z.boolean().default(false) }),
      run: () => {
        executed = true
        throw new Error('manifest must not execute command handlers')
      },
    })
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

  test('command contracts carry safety metadata into manifest and MCP annotations', async () => {
    const cli = Cli.create('app').command('delete', {
      description: 'delete a thing',
      effects: { kind: 'delete', idempotent: false },
      policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
      run: () => ({}),
    })
    const state = (cli as InternalCli)[stateSymbol]

    const envelope = manifestEnvelope('app', state)
    expect(envelope.commands[0]).toMatchObject({
      effects: { kind: 'delete', idempotent: false },
      policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
    })

    const list = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((list as any).result.tools[0].annotations).toMatchObject({
      command: 'delete',
      destructiveHint: true,
      effects: { kind: 'delete', idempotent: false },
      policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
      readOnlyHint: false,
    })
  })
})

describe('parity: command hint and usage prefix/suffix', () => {
  test('hint renders after examples in --help', async () => {
    const cli = Cli.create('app').command('do', {
      description: 'do things',
      examples: ['app do thing'],
      hint: 'Tip: combine with --watch for live updates.',
      run: () => ({ ok: true }),
    })
    const result = await runCli(cli, ['do', '--help'])
    const examplesIndex = result.stdout.indexOf('Examples:')
    const hintIndex = result.stdout.indexOf('Tip: combine')
    expect(examplesIndex).toBeGreaterThan(0)
    expect(hintIndex).toBeGreaterThan(examplesIndex)
  })

  test('usage prefix/suffix render around the binary line', async () => {
    const cli = Cli.create('curl.md').command('fetch', {
      args: z.object({ url: z.string() }),
      run: () => ({ ok: true }),
      usage: [{ args: { url: true }, prefix: 'cat file.txt | ', suffix: ' | head' }],
    })
    const result = await runCli(cli, ['fetch', '--help'])
    expect(result.stdout).toContain('cat file.txt | curl.md fetch <url> | head')
  })
})

describe('parity: vars defaults layering', () => {
  test('middleware set() overrides Zod default vars', async () => {
    const cli = Cli.create('app', {
      vars: z.object({ tier: z.string().default('free') }),
    })
      .use(middleware(async (ctx, next) => {
        ctx.set('tier', 'pro')
        await next()
      }))
      .command('whoami', {
        run: ({ var: vars }) => ({ tier: vars['tier'] }),
      })
    const result = await runCli(cli, ['whoami', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ tier: 'pro' })
  })
})

describe('parity: config object defaults', () => {
  test('--config without a configured schema raises ParseError', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({ ok: true }) })
    const result = await runCli(cli, ['run', '--config', './nope.json', '--json'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--config has no effect')
  })

  test('--no-config disables config loading even when files exist', async () => {
    const cli = Cli.create('app', {
      config: Config.object({
        schema: z.object({ modeDefault: z.string().default('from-config') }),
      }),
    }).command('run', {
      options: z.object({ mode: z.string().default('default') }),
      optionConfig: { mode: 'modeDefault' },
      run: ({ options }) => options,
    })
    const result = await runCli(cli, ['run', '--no-config', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ mode: 'default' })
  })
})

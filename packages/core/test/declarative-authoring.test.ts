import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, help as helpControl, outputControls, reflectionControls, z } from '../src/index.js'
import * as Mcp from '@liche/mcp-server'
import { manifestEnvelope } from '../src/command/registry.js'
import { renderHelp } from '../src/help/render.js'
import { parseJsonOutput, runCli, stateOf } from './helpers.js'

describe('declarative authoring API', () => {
  test('defineCli executes a command from a data-first command graph', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true })],
      commands: [
        defineCommand({
          path: ['deploy'],
          summary: 'Deploy the app',
          input: {
            args: z.object({ target: z.string() }),
            options: z.object({ dryRun: z.boolean().default(false) }),
          },
          output: z.object({ dryRun: z.boolean(), target: z.string() }),
          run: ({ input }) => ({ dryRun: input.options.dryRun, target: input.args.target }),
        }),
      ],
    })

    const result = await runCli(cli, ['deploy', 'api', '--dry-run', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ dryRun: true, target: 'api' })
  })

  test('defineCli does not expose the legacy command registration builder', () => {
    const cli = defineCli({ name: 'app', commands: [] })

    expect('command' in cli).toBe(false)
    expect((cli as any).command).toBeUndefined()
  })

  test('nested paths and same-parent aliases are declared as data', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true })],
      commands: [
        defineCommand({
          aliases: [['a']],
          path: ['admin', 'audit'],
          summary: 'Audit admin state',
          run: () => ({ ok: true }),
        }),
      ],
    })

    const direct = await runCli(cli, ['admin', 'audit', '--json'])
    const aliased = await runCli(cli, ['admin', 'a', '--json'])
    expect(parseJsonOutput(direct.stdout)).toEqual({ ok: true })
    expect(parseJsonOutput(aliased.stdout)).toEqual({ ok: true })
  })

  test('single-segment aliases accept bare strings as shorthand for [name]', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true })],
      commands: [
        defineCommand({
          aliases: ['find', ['s']],
          path: ['corpus', 'search'],
          summary: 'Search corpus',
          run: () => ({ ok: true }),
        }),
      ],
    })

    const direct = await runCli(cli, ['corpus', 'search', '--json'])
    const bare = await runCli(cli, ['corpus', 'find', '--json'])
    const nested = await runCli(cli, ['corpus', 's', '--json'])
    expect(parseJsonOutput(direct.stdout)).toEqual({ ok: true })
    expect(parseJsonOutput(bare.stdout)).toEqual({ ok: true })
    expect(parseJsonOutput(nested.stdout)).toEqual({ ok: true })
  })

  test('per-command formats render the result without affecting --json', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true, format: true, formats: ['md'] })],
      commands: [
        defineCommand({
          path: ['report'],
          formats: {
            md: (value) => {
              const data = value as { rows: { label: string; count: number }[] }
              return data.rows.map((row) => `- ${row.label}: ${row.count}`).join('\n')
            },
          },
          run: () => ({ rows: [{ label: 'a', count: 1 }, { label: 'b', count: 2 }] }),
        }),
      ],
    })

    const md = await runCli(cli, ['report', '--format', 'md'])
    expect(md.stdout.trim()).toBe('- a: 1\n- b: 2')

    const json = await runCli(cli, ['report', '--json'])
    expect(parseJsonOutput(json.stdout)).toEqual({ rows: [{ label: 'a', count: 1 }, { label: 'b', count: 2 }] })
  })

  test('option aliases and group descriptions are declared as command data', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [helpControl(), outputControls({ json: true })],
      commands: [
        defineCommand({
          path: ['jobs'],
          summary: 'Manage jobs',
        }),
        defineCommand({
          path: ['jobs', 'run'],
          input: {
            aliases: { output: 'o' },
            options: z.object({ output: z.string() }),
          },
          run: ({ input }) => ({ output: input.options.output }),
        }),
      ],
    })

    const result = await runCli(cli, ['jobs', 'run', '-o', 'dist/out.json', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ output: 'dist/out.json' })

    const help = await runCli(cli, ['--help'])
    expect(help.stdout).toContain('jobs')
    expect(help.stdout).toContain('Manage jobs')
  })

  test('manifest and MCP projection read the declarative contract without executing handlers', async () => {
    let executed = false
    const cli = defineCli({
      name: 'app',
      commands: [
        defineCommand({
          examples: ['app status'],
          path: ['status'],
          summary: 'Show status',
          run: () => {
            executed = true
            throw new Error('projection must not execute handlers')
          },
        }),
      ],
    })
    const state = stateOf(cli)

    const manifest = manifestEnvelope('app', state)
    expect(executed).toBe(false)
    expect(manifest.commands[0]).toMatchObject({
      examples: ['app status'],
      name: 'status',
      path: ['status'],
      summary: 'Show status',
    })

    const tools = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(executed).toBe(false)
    expect((tools as any).result.tools[0].annotations).toMatchObject({
      command: 'status',
      examples: ['app status'],
    })
  })

  test('help, schema, manifest, and MCP projections serialize contract data only', async () => {
    let executed = false
    const cli = defineCli({
      name: 'app',
      version: '1.0.0',
      extensions: [outputControls({ json: true }), reflectionControls({ schema: true })],
      commands: [
        defineCommand({
          examples: [{ command: 'status --verbose', description: 'Show more detail' }],
          input: {
            options: z.object({ verbose: z.boolean().default(false).describe('Show detailed status') }),
          },
          output: z.object({ ok: z.boolean() }),
          path: ['status'],
          summary: 'Show status',
          usage: [{ options: ['verbose'] }],
          run: () => {
            executed = true
            throw new Error('projection must not execute handlers')
          },
        }),
      ],
    })
    const state = stateOf(cli)

    const help = renderHelp('app', state, undefined, ['status'])
    expect(help).toContain('app status - Show status')
    expect(help).toContain('--verbose')
    expect(executed).toBe(false)

    const schema = parseJsonOutput((await runCli(cli, ['status', '--schema', '--json'])).stdout)
    expect(schema.options.properties.verbose.type).toBe('boolean')
    expect(schema.output.properties.ok.type).toBe('boolean')
    expect(executed).toBe(false)

    const manifestJson = JSON.stringify(manifestEnvelope('app', state))
    expect(manifestJson).toContain('"name":"status"')
    expect(manifestJson).not.toContain('_command')
    expect(manifestJson).not.toContain('runtime')
    expect(manifestJson).not.toContain('run')
    expect(manifestJson).not.toContain('handler')
    expect(executed).toBe(false)

    const tools = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((tools as any).result.tools[0]).toMatchObject({
      name: 'status',
      inputSchema: { properties: { options: { properties: { verbose: { type: 'boolean' } } } } },
      outputSchema: { properties: { ok: { type: 'boolean' } } },
    })
    expect(executed).toBe(false)
  })
})

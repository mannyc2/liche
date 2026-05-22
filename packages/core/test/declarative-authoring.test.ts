import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, z } from '../src/index.js'
import * as Mcp from '../src/mcp/index.js'
import { manifestEnvelope } from '../src/command/registry.js'
import { parseJsonOutput, runCli, stateOf } from './helpers.js'

describe('declarative authoring API', () => {
  test('defineCli executes a command from a data-first command graph', async () => {
    const cli = defineCli({
      name: 'app',
      commands: [
        defineCommand({
          path: ['deploy'],
          summary: 'Deploy the app',
          input: {
            args: z.object({ target: z.string() }),
            options: z.object({ dryRun: z.boolean().default(false) }),
          },
          output: z.object({ dryRun: z.boolean(), target: z.string() }),
          safety: { destructive: false, idempotent: false, interactive: 'never', openWorld: true, readOnly: false },
          run: ({ input }) => ({ dryRun: input.options.dryRun, target: input.args.target }),
        }),
      ],
    })

    const result = await runCli(cli, ['deploy', 'api', '--dry-run', '--json'])
    expect(parseJsonOutput(result.stdout)).toEqual({ dryRun: true, target: 'api' })
  })

  test('nested paths and same-parent aliases are declared as data', async () => {
    const cli = defineCli({
      name: 'app',
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

  test('manifest and MCP projection read the declarative contract without executing handlers', async () => {
    let executed = false
    const cli = defineCli({
      name: 'app',
      commands: [
        defineCommand({
          examples: ['app status'],
          path: ['status'],
          safety: { destructive: false, idempotent: true, interactive: 'never', openWorld: false, readOnly: true },
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
      safety: { readOnly: true, idempotent: true, openWorld: false },
      summary: 'Show status',
    })

    const tools = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(executed).toBe(false)
    expect((tools as any).result.tools[0].annotations).toMatchObject({
      command: 'status',
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
      safety: { readOnly: true },
    })
  })
})

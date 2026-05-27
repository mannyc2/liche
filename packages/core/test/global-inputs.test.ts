import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, defineGlobal, outputControls, z } from '../src/index.js'
import { renderHelp } from '../src/help/render.js'
import { stateOf, runCli, parseJsonData, parseJsonOutput } from './helpers.js'
import type { CliExtension } from '../src/index.js'

describe('global input definitions', () => {
  test('defineCli globals parse into ctx.global and render in help', async () => {
    const profile = defineGlobal({
      description: 'Profile to use',
      expose: 'context',
      key: 'profile',
      type: 'string',
      valueLabel: 'name',
    })
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true })],
      globals: [
        profile,
        {
          description: 'Disable prompts',
          flag: 'non-interactive',
          key: 'nonInteractive',
          type: 'boolean',
        },
      ],
      commands: [
        defineCommand({
          path: ['show'],
          output: z.record(z.string(), z.union([z.boolean(), z.string()])),
          run({ ctx }) {
            return ctx.global
          },
        }),
      ],
    })

    const result = await runCli(cli, ['show', '--profile', 'work', '--non-interactive', '--json'])
    expect(parseJsonData(result.stdout)).toEqual({ nonInteractive: true, profile: 'work' })

    const help = renderHelp('app', stateOf(cli), undefined, ['show'])
    expect(help).toContain('--profile <name>')
    expect(help).toContain('Profile to use')
    expect(help).toContain('--non-interactive')
    expect(help).toContain('Disable prompts')
  })

  test('extension globals use the same parser, help, and context registry', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true }), tenantExtension()],
      commands: [
        defineCommand({
          path: ['show'],
          output: z.object({ tenant: z.string() }),
          run({ ctx }) {
            return { tenant: String(ctx.global['tenant']) }
          },
        }),
      ],
    })

    const result = await runCli(cli, ['show', '--tenant=acme', '--json'])
    expect(parseJsonData(result.stdout)).toEqual({ tenant: 'acme' })
    expect(renderHelp('app', stateOf(cli), undefined, ['show'])).toContain('--tenant <id>')
  })

  test('global default fills ctx.global when the flag is absent and renders in help', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true })],
      globals: [
        defineGlobal({ default: 'twitte.sqlite', description: 'Database path', key: 'db', type: 'string', valueLabel: 'path' }),
      ],
      commands: [
        defineCommand({
          path: ['show'],
          output: z.object({ db: z.string() }),
          run: ({ ctx }) => ({ db: String(ctx.global['db']) }),
        }),
      ],
    })

    const fallback = await runCli(cli, ['show', '--json'])
    expect(parseJsonData(fallback.stdout)).toEqual({ db: 'twitte.sqlite' })

    const explicit = await runCli(cli, ['show', '--db', 'custom.sqlite', '--json'])
    expect(parseJsonData(explicit.stdout)).toEqual({ db: 'custom.sqlite' })

    const help = renderHelp('app', stateOf(cli), undefined, ['show'])
    expect(help).toContain('--db <path>')
    expect(help).toContain('(default: twitte.sqlite)')
  })

  test('duplicate global flags are rejected before runtime', () => {
    expect(() =>
      defineCli({
        name: 'app',
        globals: [
          { key: 'profile', type: 'string' },
          { key: 'otherProfile', flag: 'profile', type: 'string' },
        ],
      }),
    ).toThrow(/Global flag --profile is declared more than once/)

    expect(() =>
      defineCli({
        name: 'app',
        globals: [
          { alias: 'p', key: 'profile', type: 'string' },
          { alias: 'p', key: 'project', type: 'string' },
        ],
      }),
    ).toThrow(/Global alias -p is declared more than once/)
  })

  test('core globals are absent unless a control installs them', async () => {
    const cli = defineCli({
      name: 'app',
      commands: [
        defineCommand({
          path: ['show'],
          input: { options: z.object({ format: z.string() }) },
          run: ({ input }) => input.options,
        }),
      ],
    })

    expect(renderHelp('app', stateOf(cli), undefined, ['show'])).not.toContain('Global Options:')
    const result = await runCli(cli, ['show', '--format', 'yaml'])
    expect(parseJsonOutput(result.stdout)).toMatchObject({ ok: true, data: { format: 'yaml' }, error: null })
  })
})

function tenantExtension(): CliExtension {
  return {
    id: 'tenant',
    globals: [
      {
        description: 'Tenant id',
        flag: 'tenant',
        key: 'tenant',
        type: 'string',
        valueLabel: 'id',
      },
    ],
  }
}

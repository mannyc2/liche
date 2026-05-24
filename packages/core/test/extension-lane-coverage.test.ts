import { describe, expect, test } from 'bun:test'
import {
  defineCli,
  defineCommand,
  z,
} from '@liche/core'
import type {
  CliEvent,
  CliExtension,
  CliInstance,
  ConfigDefinition,
  DeclarativeCommand,
  ServeOptions,
} from '@liche/core'

type CapturedRun = { exitCode: number; stderr: string; stdout: string }

describe('extension lane coverage', () => {
  test('fixture consumes only the public package root', async () => {
    const source = await Bun.file(import.meta.path).text()
    expect(source).toContain("from '@liche/core'")
    expect(source).not.toMatch(/from ['"][^'"]*src\//)
    expect(source).not.toMatch(/from ['"][^'"]*(stateSymbol|registry|parser|InternalCli)/)
  })

  test('command and event extensions work without changing baseline command semantics', async () => {
    const events: CliEvent[] = []
    const baseline = appWithExtensions([])
    const disabled = appWithExtensions([supportExtension({ enabled: false, events })])
    const enabled = appWithExtensions([supportExtension({ enabled: true, events })])

    const baselineRun = await runCli(baseline, ['deploy', '--json'])
    const disabledRun = await runCli(disabled, ['deploy', '--json'])
    const enabledRun = await runCli(enabled, ['deploy', '--json'])

    expect(disabledRun).toEqual(baselineRun)
    expect(enabledRun).toEqual(baselineRun)
    expect(JSON.parse(enabledRun.stdout)).toEqual({
      apiBaseUrlSource: 'default',
      ok: true,
      region: 'iad',
      regionSource: 'default',
    })
    expect(events.map((event) => event.type)).toEqual([
      'command.selected',
      'command.started',
      'command.completed',
    ])

    const doctor = await runCli(enabled, ['support', 'doctor', '--json'])
    expect(JSON.parse(doctor.stdout)).toEqual({
      apiBaseUrl: 'https://default.example.test',
      apiBaseUrlSource: 'default',
      commandCount: 2,
    })
  })

  test('hook extensions can enforce non-interactive policy without core widening', async () => {
    const middlewareRuns: string[] = []
    const cli = appWithExtensions([
      middlewareSpyExtension(middlewareRuns),
      nonInteractiveConfirmationExtension(),
    ], [deleteCommand()])

    const blocked = await runCli(cli, ['delete', '--non-interactive', '--json'])
    expect(blocked.exitCode).toBe(1)
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'EXTENSION_CONFIRMATION_REQUIRED',
        suggested_fix: 'Pass --confirm or run interactively.',
      },
    })

    const confirmed = await runCli(cli, ['delete', '--non-interactive', '--confirm', '--json'])
    expect(confirmed.exitCode).toBe(0)
    expect(JSON.parse(confirmed.stdout)).toEqual({ deleted: true })
    expect(middlewareRuns).toEqual(['app'])
  })
})

function configExtension(): CliExtension {
  return {
    id: 'test-config',
    config: {
      kind: 'liche.config.object',
      schema: z.strictObject({
        apiBaseUrl: z.string().url().default('https://default.example.test'),
        defaultRegion: z.string().default('iad'),
      }),
    } as ConfigDefinition,
  }
}

function supportExtension(input: { enabled: boolean; events: CliEvent[] }): CliExtension {
  if (!input.enabled) return { id: 'support-disabled' }
  return {
    id: 'support',
    commands: [
      defineCommand({
        path: ['support', 'doctor'],
        output: z.object({
          apiBaseUrl: z.string().url(),
          apiBaseUrlSource: z.string(),
          commandCount: z.number(),
        }),
        run({ ctx }) {
          return {
            apiBaseUrl: ctx.config['apiBaseUrl'],
            apiBaseUrlSource: ctx.sources.config('apiBaseUrl').kind,
            commandCount: ctx.var['commandCount'],
          }
        },
      }),
    ],
    events: [(event) => {
      input.events.push(event as CliEvent)
    }],
  }
}

function middlewareSpyExtension(runs: string[]): CliExtension {
  return {
    id: 'middleware-spy',
    middleware: [
      async (ctx, next) => {
        runs.push(ctx.displayName)
        await next()
      },
    ],
  }
}

function nonInteractiveConfirmationExtension(): CliExtension {
  return {
    id: 'non-interactive-confirmation',
    globals: [
      {
        description: 'Disable interactive prompts',
        flag: 'non-interactive',
        key: 'nonInteractive',
        type: 'boolean',
      },
    ],
    hooks: {
      beforeExecute(ctx) {
        if (ctx.global.nonInteractive && ctx.options['confirm'] !== true) {
          return ctx.error({
            code: 'EXTENSION_CONFIRMATION_REQUIRED',
            message: 'Confirmation is required in non-interactive mode.',
            suggested_fix: 'Pass --confirm or run interactively.',
          })
        }
        return undefined
      },
    },
  }
}

function appWithExtensions(
  extensions: readonly CliExtension[],
  commands: readonly DeclarativeCommand[] = [deployCommand()],
): CliInstance {
  const allExtensions = [configExtension(), ...extensions]
  return defineCli({
    name: 'app',
    vars: z.object({ commandCount: z.number().default(commands.length + extensionCommands(allExtensions).length) }),
    commands,
    extensions: allExtensions,
  })
}

function deployCommand(): DeclarativeCommand {
  return defineCommand({
    path: ['deploy'],
    input: {
      options: z.object({ region: z.string().default('iad') }),
      config: { region: 'defaultRegion' },
    },
    output: z.object({
      apiBaseUrlSource: z.string(),
      ok: z.boolean(),
      region: z.string(),
      regionSource: z.string(),
    }),
    run({ ctx, input }) {
      return {
        apiBaseUrlSource: ctx.sources.config('apiBaseUrl').kind,
        ok: true,
        region: input.options.region,
        regionSource: ctx.sources.option('region'),
      }
    },
  })
}

function deleteCommand(): DeclarativeCommand {
  return defineCommand({
    path: ['delete'],
    input: {
      options: z.object({ confirm: z.boolean().default(false) }),
    },
    output: z.object({ deleted: z.boolean() }),
    run() {
      return { deleted: true }
    },
  })
}

function extensionCommands(extensions: readonly CliExtension[]): DeclarativeCommand[] {
  return extensions.flatMap((extension) => [...(extension.commands ?? [])])
}

async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<ServeOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<CapturedRun> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await cli.serve(argv, {
    ...options,
    exit(code) {
      exitCode = code
    },
    stderr(chunk) {
      stderr += chunk
    },
    stdout(chunk) {
      stdout += chunk
    },
    isTty: options.isTty ?? false,
  })
  return { exitCode, stderr, stdout }
}

import { describe, expect, test } from 'bun:test'
import {
  Config,
  LiliError,
  defineCli,
  defineCommand,
  z,
} from '@lili/core'
import type {
  BeforeExecuteHook,
  CliEvent,
  CliEventRegistration,
  CliInstance,
  DeclarativeCommand,
  DefineCliOptions,
  MiddlewareHandler,
  ServeOptions,
} from '@lili/core'

type CapturedRun = { exitCode: number; stderr: string; stdout: string }
type ExtensionLane = {
  commands?: readonly DeclarativeCommand[] | undefined
  events?: readonly CliEventRegistration[] | undefined
  hooks?: DefineCliOptions['hooks'] | undefined
  middleware?: readonly MiddlewareHandler[] | undefined
}

describe('extension lane coverage', () => {
  test('fixture consumes only the public package root', async () => {
    const source = await Bun.file(import.meta.path).text()
    expect(source).toContain("from '@lili/core'")
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
    const cli = appWithExtensions([nonInteractiveConfirmationExtension()], [deleteCommand()])

    const blocked = await runCli(cli, ['delete', '--non-interactive', '--json'])
    expect(blocked.exitCode).toBe(1)
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      code: 'EXTENSION_CONFIRMATION_REQUIRED',
      suggested_fix: 'Pass --confirm or run interactively.',
    })

    const confirmed = await runCli(cli, ['delete', '--non-interactive', '--confirm', '--json'])
    expect(confirmed.exitCode).toBe(0)
    expect(JSON.parse(confirmed.stdout)).toEqual({ deleted: true })
  })
})

function supportExtension(input: { enabled: boolean; events: CliEvent[] }): ExtensionLane {
  if (!input.enabled) return {}
  return {
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

function nonInteractiveConfirmationExtension(): ExtensionLane {
  return {
    hooks: {
      beforeExecute(ctx) {
        if (ctx.global.nonInteractive && ctx.options['confirm'] !== true) {
          throw new LiliError({
            code: 'EXTENSION_CONFIRMATION_REQUIRED',
            message: 'Confirmation is required in non-interactive mode.',
            suggested_fix: 'Pass --confirm or run interactively.',
          })
        }
      },
    },
  }
}

function appWithExtensions(
  extensions: readonly ExtensionLane[],
  commands: readonly DeclarativeCommand[] = [deployCommand()],
): CliInstance {
  return defineCli({
    name: 'app',
    config: Config.object({
      schema: z.strictObject({
        apiBaseUrl: z.string().url().default('https://default.example.test'),
        defaultRegion: z.string().default('iad'),
      }),
    }),
    vars: z.object({ commandCount: z.number().default(commands.length + extensionCommands(extensions).length) }),
    commands: [...commands, ...extensionCommands(extensions)],
    events: extensions.flatMap((extension) => [...(extension.events ?? [])]),
    hooks: mergeHooks(extensions),
    middleware: extensions.flatMap((extension) => [...(extension.middleware ?? [])]),
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

function extensionCommands(extensions: readonly ExtensionLane[]): DeclarativeCommand[] {
  return extensions.flatMap((extension) => [...(extension.commands ?? [])])
}

function mergeHooks(extensions: readonly ExtensionLane[]): DefineCliOptions['hooks'] | undefined {
  const beforeExecute = extensions.flatMap((extension) => hookList(extension.hooks?.beforeExecute))
  return beforeExecute.length > 0 ? { beforeExecute } : undefined
}

function hookList(hook: BeforeExecuteHook | readonly BeforeExecuteHook[] | undefined): BeforeExecuteHook[] {
  if (hook === undefined) return []
  return typeof hook === 'function' ? [hook] : [...hook]
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

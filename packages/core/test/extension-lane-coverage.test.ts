import { describe, expect, test } from 'bun:test'
import {
  defineCli,
  defineCommand,
  outputControls,
  run,
  z,
} from '@liche/core'
import type {
  CliExtension,
  CliInstance,
  DeclarativeCommand,
  RunOptions,
} from '@liche/core'

type CapturedRun = { exitCode: number; stderr: string; stdout: string }

describe('extension lane coverage', () => {
  test('fixture consumes only the public package root', async () => {
    const source = await Bun.file(import.meta.path).text()
    expect(source).toContain("from '@liche/core'")
    expect(source).not.toMatch(/from ['"][^'"]*src\//)
    expect(source).not.toMatch(/from ['"][^'"]*(stateSymbol|registry|parser|InternalCli)/)
  })

  test('hook extensions can enforce non-interactive policy without core widening', async () => {
    const middlewareRuns: string[] = []
    const cli = appWithExtensions([
      outputControls({ json: true }),
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
  commands: readonly DeclarativeCommand[],
): CliInstance {
  return defineCli({
    name: 'app',
    vars: z.object({ commandCount: z.number().default(commands.length) }),
    commands,
    extensions,
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

async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<RunOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<CapturedRun> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await run(cli, argv, {
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

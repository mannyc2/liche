import type {
  CliEvent,
  CliEventSubscription,
  CliEventSurface,
  CliInstance,
  CliState,
  CommandError,
  Dict,
  Format,
  Result,
  RunContext,
  ServeOptions,
} from '../types.js'
import { fail, ParseError } from '../errors/error.js'
import { toCommandError } from '../errors/normalize.js'
import { parseGlobals } from '../parser/index.js'
import { selectCommand } from '../command/registry.js'
import { execute } from './execute.js'
import { getCliState } from './create.js'
import { contextGlobals, defaultEnv, isFlagLikeToken, resolveFormat, runPrepareContext } from './invocation.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from './lifecycle.js'

export type DispatchOptions = {
  env?: Dict<string | undefined> | undefined
  format?: Format | undefined
  isTty?: boolean | undefined
  onChunk?: ((chunk: unknown) => void | Promise<void>) | undefined
}

export async function run(
  cli: CliInstance,
  argv?: string[],
  options?: ServeOptions,
): Promise<void> {
  return cli.serve(argv, options)
}

export async function dispatch(
  cli: CliInstance,
  argv: string[],
  options: DispatchOptions = {},
): Promise<Result> {
  const state = getCliState(cli)
  const name = cli.name
  const env = options.env ?? defaultEnv()
  const isTty = options.isTty ?? false
  const baseResolved = resolveFormat({ explicit: options.format, cliDefault: state.def.format })
  const baseFormat = baseResolved.format
  const baseFormatExplicit = baseResolved.formatExplicit

  let flags
  try {
    flags = parseGlobals(argv, state.globals)
  } catch (error) {
    const commandError = preExecuteCommandError(error)
    await emitFailure(state, name, {
      isTty,
      format: baseFormat,
      formatExplicit: baseFormatExplicit,
      surfaceKind: 'parse',
      type: 'parse.failed',
      error: commandError,
    })
    return fail(commandError)
  }

  const preselectionResolved = resolveFormat({ explicit: options.format, flags, cliDefault: state.def.format })
  const outputFormat = preselectionResolved.format
  const formatExplicit = preselectionResolved.formatExplicit

  const reject = async (
    error: CommandError,
    surfaceKind: CliEventSurface['kind'],
    type: CliEvent['type'],
    selectedEvents?: readonly CliEventSubscription[],
    command?: CliEvent['command'],
  ): Promise<Result> => {
    await emitFailure(state, name, {
      isTty,
      format: outputFormat,
      formatExplicit,
      surfaceKind,
      type,
      error,
      ...(command ? { command } : undefined),
      ...(selectedEvents ? { extraEvents: selectedEvents } : undefined),
    })
    return fail(error)
  }

  if (env['COMPLETE']) {
    return reject(
      {
        code: 'PARSE_ERROR',
        message: 'Shell completion is only available through serve, not dispatch',
        exitCode: 1,
      },
      'parse',
      'parse.failed',
    )
  }
  if (flags.version) {
    return reject(
      {
        code: 'PARSE_ERROR',
        message: '--version is only available through serve, not dispatch',
        exitCode: 1,
      },
      'parse',
      'parse.failed',
    )
  }
  if (flags.help) {
    return reject(
      {
        code: 'PARSE_ERROR',
        message: '--help is only available through serve, not dispatch',
        exitCode: 1,
      },
      'parse',
      'parse.failed',
    )
  }
  if (flags.schema) {
    return reject(
      {
        code: 'PARSE_ERROR',
        message: '--schema is only available through serve, not dispatch',
        exitCode: 1,
      },
      'parse',
      'parse.failed',
    )
  }
  for (const handler of state.serveHandlers) {
    if (flags[handler.flagKey]) {
      return reject(
        {
          code: 'PARSE_ERROR',
          message: `--${handler.flagKey} is only available through serve, not dispatch`,
          exitCode: 1,
        },
        'parse',
        'parse.failed',
      )
    }
  }

  const selected = selectCommand(state, flags.rest)
  if (!selected) {
    if (flags.rest.some(isFlagLikeToken)) {
      const token = flags.rest.find(isFlagLikeToken) ?? flags.rest[0] ?? ''
      return reject(
        { code: 'PARSE_ERROR', message: `Unknown option: ${token}`, exitCode: 1 },
        'parse',
        'parse.failed',
      )
    }
    const path = flags.rest.join(' ')
    return reject(
      {
        code: 'COMMAND_NOT_FOUND',
        message: path ? `Unknown command: ${path}` : 'No command specified',
        exitCode: 1,
      },
      'command',
      'command.not_found',
    )
  }

  const executeFormat = resolveFormat({
    explicit: options.format,
    flags,
    selected,
    cliDefault: state.def.format,
  }).format

  let contextOverrides: Partial<RunContext>
  try {
    contextOverrides = await runPrepareContext(
      [...state.hooks.prepareContext, ...selected.hooks.prepareContext],
      { name, env, flags },
    )
  } catch (error) {
    return reject(
      preExecuteCommandError(error),
      'parse',
      'parse.failed',
      selected.events,
      eventCommand(selected),
    )
  }

  return execute(name, selected, {
    argvOptions: selected.argv,
    contextOverrides,
    displayName: name,
    env,
    events: state.events.concat(selected.events),
    flags,
    format: executeFormat,
    formatExplicit,
    global: contextGlobals(flags, state),
    hooks: mergeHooks(state.hooks, selected.hooks),
    inputSources: state.inputSources,
    isTty,
    middlewares: state.middlewares.concat(selected.middlewares),
    ...(options.onChunk ? { onChunk: options.onChunk } : undefined),
    version: state.def.version,
  })
}

function preExecuteCommandError(error: unknown): CommandError {
  if (error instanceof ParseError) {
    return { code: 'PARSE_ERROR', message: error.shortMessage, exitCode: 1 }
  }
  return toCommandError(error)
}

async function emitFailure(
  state: CliState,
  name: string,
  input: {
    isTty: boolean
    format: Format
    formatExplicit: boolean
    surfaceKind: CliEventSurface['kind']
    type: CliEvent['type']
    error: CommandError
    command?: CliEvent['command']
    extraEvents?: readonly CliEventSubscription[]
  },
): Promise<void> {
  const subscriptions = input.extraEvents
    ? state.events.concat(input.extraEvents)
    : state.events
  const exitCode = Number(input.error.exitCode ?? 1)
  const event: Omit<CliEvent, 'cli' | 'occurredAt'> = {
    isTty: input.isTty,
    format: input.format,
    formatExplicit: input.formatExplicit,
    surface: { kind: input.surfaceKind },
    type: input.type,
    ...(input.command ? { command: input.command } : undefined),
    ...(input.type === 'parse.failed'
      ? {
          error: { code: input.error.code, exitCode },
          exitCode,
          result: 'user_error',
        }
      : { error: { code: input.error.code } }),
  }
  await emitLifecycleEvent(
    subscriptions,
    createLifecycleEvent(name, state.def.version, event),
  )
}

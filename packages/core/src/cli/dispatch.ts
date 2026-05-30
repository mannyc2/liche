import type {
  CliEvent,
  CliEventSubscription,
  CliEventSurface,
  CliInstance,
  CliState,
  CommandError,
  Dict,
  Format,
  ParsedInvocation,
  ParsedInvocationContextPatch,
  ParseInvocationResult,
  ParseWarning,
  Result,
  RunContext,
  RunOptions,
  SourceInspector,
} from '../types.js'
import { fail, ok, ParseError } from '../errors/error.js'
import { toCommandError } from '../errors/normalize.js'
import { parseGlobals } from '../parser/index.js'
import { selectCommand } from '../command/registry.js'
import { commandContract } from '../command/contract.js'
import { isCommand } from '../command/guards.js'
import { execute } from './execute.js'
import { getCliState } from './create.js'
import { contextGlobals, defaultEnv, isFlagLikeToken, resolveFormat, runPrepareContext } from './invocation.js'
import { resolveCommandInput } from './input-sources.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from './lifecycle.js'
import { runTerminalCli } from './terminal.js'
import { nonInteractiveStdio, streamKinds, type StreamKinds, type StreamOverrides } from './stdio.js'
import { matchedTerminalFlag } from './terminal-handlers.js'

export type DispatchOptions = {
  env?: Dict<string | undefined> | undefined
  format?: Format | undefined
  streams?: StreamOverrides | undefined
  onChunk?: ((chunk: unknown) => void | Promise<void>) | undefined
}

export async function run(
  cli: CliInstance,
  argv?: string[],
  options: RunOptions = {},
): Promise<void> {
  const state = getCliState(cli)
  return runTerminalCli(cli.name, state, argv ?? Bun.argv.slice(2), options)
}

export async function dispatch(
  cli: CliInstance,
  argv: string[],
  options: DispatchOptions = {},
): Promise<Result> {
  const state = getCliState(cli)
  const name = cli.name
  const env = options.env ?? defaultEnv()
  const stdio = nonInteractiveStdio(options.streams)
  const streams = streamKinds(stdio)
  const baseResolved = resolveFormat({ explicit: options.format, cliDefault: state.def.format })
  const baseFormat = baseResolved.format
  const baseFormatExplicit = baseResolved.formatExplicit

  let flags
  try {
    flags = parseGlobals(argv, state.globals)
  } catch (error) {
    const commandError = preExecuteCommandError(error)
    await emitFailure(state, name, {
      streams,
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
      streams,
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
        message: 'Shell completion is only available through run, not dispatch',
        exitCode: 1,
      },
      'parse',
      'parse.failed',
    )
  }
  const terminalFlag = matchedTerminalFlag(flags, state)
  if (terminalFlag) {
    return reject(
      { code: 'PARSE_ERROR', message: `--${terminalFlag} is only available through run, not dispatch`, exitCode: 1 },
      'parse',
      'parse.failed',
    )
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
    stdio,
    middlewares: state.middlewares.concat(selected.middlewares),
    ...(options.onChunk ? { onChunk: options.onChunk } : undefined),
    version: state.def.version,
  })
}

export type ParseInvocationOptions = {
  env?: Dict<string | undefined> | undefined
  format?: Format | undefined
}

export async function parseInvocation(
  cli: CliInstance,
  argv: string[],
  options: ParseInvocationOptions = {},
): Promise<ParseInvocationResult> {
  const state = getCliState(cli)
  const env = options.env ?? defaultEnv()

  let flags
  try {
    flags = parseGlobals(argv, state.globals)
  } catch (error) {
    return fail(preExecuteCommandError(error)) as ParseInvocationResult
  }

  if (env['COMPLETE']) {
    return fail({
      code: 'PARSE_ERROR',
      message: 'Shell completion is only available through run, not parseInvocation',
      exitCode: 1,
    }) as ParseInvocationResult
  }
  const terminalFlag = matchedTerminalFlag(flags, state)
  if (terminalFlag) {
    return fail({
      code: 'PARSE_ERROR',
      message: `--${terminalFlag} is only available through run, not parseInvocation`,
      exitCode: 1,
    }) as ParseInvocationResult
  }

  const selected = selectCommand(state, flags.rest)
  if (!selected) {
    if (flags.rest.some(isFlagLikeToken)) {
      const token = flags.rest.find(isFlagLikeToken) ?? flags.rest[0] ?? ''
      return fail({ code: 'PARSE_ERROR', message: `Unknown option: ${token}`, exitCode: 1 }) as ParseInvocationResult
    }
    const path = flags.rest.join(' ')
    return fail({
      code: 'COMMAND_NOT_FOUND',
      message: path ? `Unknown command: ${path}` : 'No command specified',
      exitCode: 1,
    }) as ParseInvocationResult
  }

  const resolved = resolveFormat({
    explicit: options.format,
    flags,
    selected,
    cliDefault: state.def.format,
  })

  let contextOverrides: Partial<RunContext>
  try {
    contextOverrides = await runPrepareContext(
      [...state.hooks.prepareContext, ...selected.hooks.prepareContext],
      { name: cli.name, env, flags },
    )
  } catch (error) {
    return fail(preExecuteCommandError(error)) as ParseInvocationResult
  }

  if (!isCommand(selected.entry)) {
    return fail({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no run handler', exitCode: 1 }) as ParseInvocationResult
  }
  const runtime = selected.entry.runtime
  if (!runtime.run) {
    return fail({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no run handler', exitCode: 1 }) as ParseInvocationResult
  }

  const warnings: ParseWarning[] = []
  let resolvedInput
  try {
    resolvedInput = await resolveCommandInput({
      argvOptions: selected.argv,
      commandPath: selected.path,
      env,
      flags,
      inputSources: state.inputSources,
      onDeprecation: (flag, option) => warnings.push({ kind: 'deprecated-option', flag, option }),
      runtime,
    })
  } catch (error) {
    return fail(toCommandError(error)) as ParseInvocationResult
  }

  const overridePatch = narrowContextPatch(contextOverrides)
  const mergedInput = {
    args: 'args' in overridePatch ? overridePatch.args : resolvedInput.args,
    options: 'options' in overridePatch ? overridePatch.options : resolvedInput.options,
    env: 'env' in overridePatch ? overridePatch.env : resolvedInput.env,
  }
  const mergedSources: SourceInspector = overridePatch.sources ?? resolvedInput.sources
  const baseGlobals = contextGlobals(flags, state)

  const contract = commandContract(selected.path.join(' ') || '(root)', selected.entry)
  if (!contract) {
    return fail({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no contract', exitCode: 1 }) as ParseInvocationResult
  }

  const data: ParsedInvocation = {
    command: contract,
    contextOverrides: overridePatch,
    format: overridePatch.format ?? resolved.format,
    formatExplicit: overridePatch.formatExplicit ?? resolved.formatExplicit,
    globals: overridePatch.globals ?? baseGlobals,
    input: mergedInput,
    sources: mergedSources,
    warnings,
  }
  return ok(data) as ParseInvocationResult
}

function narrowContextPatch(overrides: Partial<RunContext>): ParsedInvocationContextPatch {
  const patch: ParsedInvocationContextPatch = {}
  if ('args' in overrides) patch.args = overrides.args
  if ('options' in overrides) patch.options = overrides.options
  if ('env' in overrides) patch.env = overrides.env
  if ('sources' in overrides && overrides.sources) patch.sources = overrides.sources as SourceInspector
  if ('format' in overrides && overrides.format) patch.format = overrides.format
  if ('formatExplicit' in overrides && typeof overrides.formatExplicit === 'boolean') {
    patch.formatExplicit = overrides.formatExplicit
  }
  if ('global' in overrides && overrides.global) patch.globals = overrides.global
  return patch
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
    streams: StreamKinds
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
    streams: input.streams,
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

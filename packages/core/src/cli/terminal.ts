import type { CliEvent, CliEventSubscription, CliState, Format, RunContext, RunOptions } from '../types.js'
import { execute } from './execute.js'
import { ParseError } from '../errors/error.js'
import { formatCta, pick, renderOutput } from '../format/index.js'
import { parseGlobals } from '../parser/index.js'
import { commandFormatRenderers, outputPolicy, selectCommand } from '../command/registry.js'
import { renderHelp } from '../help/render.js'
import { commandContract } from '../command/contract.js'
import { complete, shells } from '../completions/shells.js'
import { formatHumanValidationError } from './human-validation-error.js'
import { DEFAULT_FORMAT, contextGlobals, defaultEnv, isFlagLikeToken, resolveFormat, runPrepareContext } from './invocation.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from './lifecycle.js'

export async function runTerminalCli(
  name: string,
  state: CliState,
  argv: string[],
  options: RunOptions = {},
): Promise<void> {
  const io = {
    err: options.stderr ?? ((s: string) => void Bun.stderr.write(s)),
    out: options.stdout ?? ((s: string) => void Bun.stdout.write(s)),
  }
  const env = options.env ?? defaultEnv()
  const isTty = options.isTty ?? process.stdout.isTTY === true

  let flags
  try {
    flags = parseGlobals(argv, state.globals)
  } catch (error) {
    if (error instanceof ParseError) {
      await emitTerminalLifecycle(name, state, state.events, {
        isTty,
        error: { code: 'PARSE_ERROR', exitCode: 1 },
        exitCode: 1,
        format: state.def.format ?? DEFAULT_FORMAT,
        formatExplicit: false,
        result: 'user_error',
        surface: { kind: 'parse' },
        type: 'parse.failed',
      })
      io.err(`Error (PARSE_ERROR): ${error.shortMessage}\n`)
      ;(options.exit ?? process.exit)(1)
      return
    }
    throw error
  }
  const rootResolved = resolveFormat({ flags, cliDefault: state.def.format })
  const rootOutputFormat = rootResolved.format
  const formatExplicit = rootResolved.formatExplicit
  const human = !flags.formatExplicit && !flags.json && isTty

  if (env['COMPLETE']) {
    if (!shells.includes(env['COMPLETE'] as any)) {
      await emitTerminalLifecycle(name, state, state.events, {
        isTty,
        error: { code: 'PARSE_ERROR' },
        format: rootOutputFormat,
        formatExplicit,
        result: 'user_error',
        surface: { kind: 'completion' },
        type: 'parse.failed',
      })
      io.err(`Unknown completion shell '${env['COMPLETE']}'. Supported: ${shells.join(', ')}\n`)
      return
    }
    const suggestions = complete(state, flags.rest, Math.max(flags.rest.length - 1, 0))
    await emitTerminalLifecycle(name, state, state.events, {
      isTty,
      completion: { shell: env['COMPLETE'], suggestionCount: suggestions.length },
      format: rootOutputFormat,
      formatExplicit,
      surface: { kind: 'completion' },
      type: 'completion.generated',
    })
    return io.out(`${suggestions.join('\n')}${suggestions.length ? '\n' : ''}`)
  }

  if (flags.version) {
    await emitTerminalLifecycle(name, state, state.events, {
      isTty,
      format: rootOutputFormat,
      formatExplicit,
      surface: { kind: 'version' },
      type: 'version.rendered',
    })
    return io.out(`${state.def.version ?? '0.0.0'}\n`)
  }
  for (const handler of state.terminalHandlers) {
    if (flags[handler.flagKey]) return await handler.handle({ binaryName: name, flags, options, state })
  }

  const selected = selectCommand(state, flags.rest)
  const outputFormat = resolveFormat({ flags, selected, cliDefault: state.def.format }).format
  if (!selected && flags.rest.some(isFlagLikeToken)) {
    await emitTerminalLifecycle(name, state, state.events, {
      isTty,
      error: { code: 'PARSE_ERROR', exitCode: 1 },
      exitCode: 1,
      format: outputFormat,
      formatExplicit,
      result: 'user_error',
      surface: { kind: 'parse' },
      type: 'parse.failed',
    })
    const token = flags.rest.find(isFlagLikeToken) ?? flags.rest[0] ?? ''
    io.err(`Error (PARSE_ERROR): Unknown option: ${token}\n`)
    ;(options.exit ?? process.exit)(1)
    return
  }
  if (!selected && flags.rest.length > 0) {
    await emitTerminalLifecycle(name, state, state.events, {
      isTty,
      error: { code: 'COMMAND_NOT_FOUND' },
      format: outputFormat,
      formatExplicit,
      surface: { kind: 'command' },
      type: 'command.not_found',
    })
  }
  if (flags.help || !selected) {
    await emitTerminalLifecycle(name, state, selected ? state.events.concat(selected.events) : state.events, {
      isTty,
      ...(selected ? { command: eventCommand(selected) } : undefined),
      format: outputFormat,
      formatExplicit,
      surface: { kind: 'help' },
      type: 'help.rendered',
    })
    return io.out(`${renderHelp(name, state, selected, flags.rest)}\n`)
  }
  if (flags.schema) {
    await emitTerminalLifecycle(name, state, state.events.concat(selected.events), {
      isTty,
      command: eventCommand(selected),
      format: outputFormat,
      formatExplicit,
      surface: { kind: 'schema' },
      type: 'schema.generated',
    })
    return io.out(`${renderOutput(commandContract(selected.path.join(' ') || '(root)', selected.entry)?.schema, outputFormat, state.outputRenderers, { stage: 'schema' })}\n`)
  }

  const prepareHooks = [...state.hooks.prepareContext, ...selected.hooks.prepareContext]
  let contextOverrides: Partial<RunContext>
  try {
    contextOverrides = await runPrepareContext(prepareHooks, { name, env, flags })
  } catch (error) {
    if (error instanceof ParseError) {
      await emitTerminalLifecycle(name, state, state.events.concat(selected.events), {
        isTty,
        command: eventCommand(selected),
        error: { code: 'PARSE_ERROR', exitCode: 1 },
        exitCode: 1,
        format: outputFormat,
        formatExplicit,
        result: 'user_error',
        surface: { kind: 'parse' },
        type: 'parse.failed',
      })
      io.err(`Error (PARSE_ERROR): ${error.shortMessage}\n`)
      ;(options.exit ?? process.exit)(1)
      return
    }
    throw error
  }

  const policy = outputPolicy(selected) ?? state.def.outputPolicy ?? 'all'
  const transformsBuffering = state.outputTransforms.some((t) => (t.bufferingFlagKeys ?? []).some((key) => Boolean(flags[key])))
  const streamingEligible = !flags.filterOutput && !transformsBuffering && outputFormat === 'jsonl'
  let streamed = false
  const chunkFormat: Format = outputFormat === 'jsonl' ? 'jsonl' : outputFormat

  const result = await execute(name, selected, {
    argvOptions: selected.argv,
    contextOverrides,
    displayName: name,
    env,
    events: state.events.concat(selected.events),
    flags,
    format: outputFormat,
    formatExplicit,
    global: contextGlobals(flags, state),
    hooks: mergeHooks(state.hooks, selected.hooks),
    inputSources: state.inputSources,
    isTty,
    middlewares: state.middlewares.concat(selected.middlewares),
    onDeprecation: (flag) => {
      if (isTty) io.err(`warning: ${flag} is deprecated\n`)
    },
    onChunk: streamingEligible
      ? (chunk) => {
          streamed = true
          const value = outputFormat === 'jsonl' ? { type: 'chunk', data: chunk } : chunk
          const text = renderOutput(value, chunkFormat, state.outputRenderers, { stage: 'chunk' })
          io.out(text.endsWith('\n') ? text : `${text}\n`)
        }
      : undefined,
    version: state.def.version,
  })

  const exitCode = result.ok ? 0 : Number(result.error.exitCode ?? 1)
  const envelopeFormat = isMachineFormat(outputFormat)
  let data: unknown
  if (envelopeFormat) {
    data = flags.filterOutput && result.ok ? { ...result, data: pick(result.data, flags.filterOutput) } : result
  } else {
    data = result.ok ? result.data : result.error
    if (flags.filterOutput && result.ok) data = pick(data, flags.filterOutput)
  }

  const localRenderer = commandFormatRenderers(selected)?.[outputFormat]
  const rendered = localRenderer
    ? localRenderer(data, { format: outputFormat, stage: 'result' })
    : renderOutput(data, outputFormat, state.outputRenderers, { stage: 'result' })
  let text = rendered
  for (const transform of state.outputTransforms) {
    text = transform.transform(text, { flags, format: outputFormat, stage: 'result' })
  }

  const suppressStreamedRecap = streamed && result.ok && outputFormat !== 'jsonl'
  if (!(policy === 'machine-only' && human && result.ok) && !suppressStreamedRecap) io.out(text.endsWith('\n') ? text : `${text}\n`)
  if (result.meta?.cta) io.err(formatCta(name, result.meta.cta))
  if (!result.ok && human) {
    if (result.error.fieldErrors?.length) {
      io.err(`${formatHumanValidationError(name, state, selected, result.error.fieldErrors)}\n`)
    } else {
      io.err(`Error (${result.error.code ?? 'UNKNOWN'}): ${result.error.message ?? text}\n`)
    }
  }

  if (exitCode) (options.exit ?? process.exit)(exitCode)
}

async function emitTerminalLifecycle(
  binaryName: string,
  state: CliState,
  subscriptions: readonly CliEventSubscription[],
  event: Omit<CliEvent, 'cli' | 'occurredAt'>,
): Promise<void> {
  await emitLifecycleEvent(subscriptions, createLifecycleEvent(binaryName, state.def.version, event))
}

function isMachineFormat(format: Format): boolean {
  return format === 'json' || format === 'jsonl' || format === 'yaml'
}


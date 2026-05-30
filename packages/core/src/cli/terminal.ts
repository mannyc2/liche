import { writeSync } from 'node:fs'
import type { CliEvent, CliEventSubscription, CliState, Format, RunContext, RunOptions } from '../types.js'
import { execute } from './execute.js'
import { captureStdio, streamKinds } from './stdio.js'
import { ParseError } from '../errors/error.js'
import { formatCta, pick, renderOutput } from '../format/index.js'
import { parseGlobals } from '../parser/index.js'
import { commandFormatRenderers, outputPolicy, selectCommand } from '../command/registry.js'
import { toCommandInfo } from './terminal-handlers.js'
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
  const env = options.env ?? defaultEnv()
  const stdio = captureStdio(env, options.streams)
  const streams = streamKinds(stdio)
  // Final/terminal output is written SYNCHRONOUSLY so it fully flushes before any
  // process.exit (no truncation on the nonzero-exit path), and so a broken pipe
  // (`… | head`) surfaces as a catchable synchronous EPIPE rather than an unhandled
  // async crash — at which point we leave cleanly, like a well-behaved Unix tool.
  // Injected writers (tests/programmatic) bypass this and keep their exact behavior.
  const writeFinal = (fd: 1 | 2, s: string): void => {
    try {
      writeSync(fd, s)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
        ;(options.exit ?? process.exit)(0) // reader hung up; nothing left to say
        return
      }
      throw error
    }
  }
  // Streaming chunks are AWAITED (execute awaits onChunk once per chunk), so they land in
  // yield order and every chunk fully flushes before the run's eager process.exit. The old
  // fire-and-forget `void Bun.stdout.write` let concurrent writes to a file sink complete out
  // of order — the stream arrived scrambled (a race, ~5-in-6 runs). Serializing the awaited
  // writes is the correct backpressure. A broken pipe (`… | head`) surfaces as a rejected
  // write, handled exactly like the sync path: the reader hung up, so we leave cleanly.
  const writeChunk = async (s: string): Promise<void> => {
    try {
      await Bun.stdout.write(s)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
        ;(options.exit ?? process.exit)(0)
        return
      }
      throw error
    }
  }
  const io = {
    err: options.stderr ?? ((s: string) => writeFinal(2, s)),
    out: options.stdout ?? ((s: string) => writeFinal(1, s)),
    chunk: options.stdout ?? writeChunk,
  }

  let flags
  try {
    flags = parseGlobals(argv, state.globals)
  } catch (error) {
    if (error instanceof ParseError) {
      await emitTerminalLifecycle(name, state, state.events, {
        streams,
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
  const human = !flags.formatExplicit && !flags.json && stdio.stdout.isTTY

  if (env['COMPLETE']) {
    if (!shells.includes(env['COMPLETE'] as any)) {
      await emitTerminalLifecycle(name, state, state.events, {
        streams,
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
      streams,
      completion: { shell: env['COMPLETE'], suggestionCount: suggestions.length },
      format: rootOutputFormat,
      formatExplicit,
      surface: { kind: 'completion' },
      type: 'completion.generated',
    })
    return io.out(`${suggestions.join('\n')}${suggestions.length ? '\n' : ''}`)
  }

  const terminalHandlers = state.terminalHandlers
  // Command-AGNOSTIC terminal flags (version, extension handlers) short-circuit BEFORE
  // command selection, ignoring the rest of argv — so `cli --version --x` prints the version
  // and `cli --llms junk` lists commands, rather than erroring on the extra token.
  for (const handler of terminalHandlers) {
    if (handler.commandAware) continue
    if (!(handler.matches ? handler.matches(flags, undefined) : Boolean(flags[handler.flagKey]))) continue
    if (handler.event) {
      await emitTerminalLifecycle(name, state, state.events, {
        streams,
        format: rootOutputFormat,
        formatExplicit,
        surface: { kind: 'terminal', name: handler.event.surface },
        type: handler.event.type,
      })
    }
    await handler.handle({ binaryName: name, flags, options, state, selected: undefined, format: rootOutputFormat, io })
    return
  }

  const selected = selectCommand(state, flags.rest)
  const outputFormat = resolveFormat({ flags, selected, cliDefault: state.def.format }).format
  if (!selected && flags.rest.some(isFlagLikeToken)) {
    await emitTerminalLifecycle(name, state, state.events, {
      streams,
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
      streams,
      error: { code: 'COMMAND_NOT_FOUND' },
      format: outputFormat,
      formatExplicit,
      surface: { kind: 'command' },
      type: 'command.not_found',
    })
  }
  // Command-AWARE terminal flags (help fallback, schema) run AFTER selection and after the
  // unknown-option / command-not-found checks, matching the legacy order.
  const selectedInfo = toCommandInfo(selected)
  for (const handler of terminalHandlers) {
    if (!handler.commandAware) continue
    const matches = handler.matches ? handler.matches(flags, selectedInfo) : Boolean(flags[handler.flagKey])
    if (!matches) continue
    if (handler.event) {
      await emitTerminalLifecycle(name, state, selected ? state.events.concat(selected.events) : state.events, {
        streams,
        ...(selected ? { command: eventCommand(selected) } : undefined),
        format: outputFormat,
        formatExplicit,
        surface: { kind: 'terminal', name: handler.event.surface },
        type: handler.event.type,
      })
    }
    await handler.handle({ binaryName: name, flags, options, state, selected: selectedInfo, format: outputFormat, io })
    return
  }
  // The help handler renders whenever no command resolves, so `selected` is defined below.
  if (!selected) return

  const prepareHooks = [...state.hooks.prepareContext, ...selected.hooks.prepareContext]
  let contextOverrides: Partial<RunContext>
  try {
    contextOverrides = await runPrepareContext(prepareHooks, { name, env, flags })
  } catch (error) {
    if (error instanceof ParseError) {
      await emitTerminalLifecycle(name, state, state.events.concat(selected.events), {
        streams,
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
    stdio,
    middlewares: state.middlewares.concat(selected.middlewares),
    onDeprecation: (flag) => {
      if (stdio.stderr.isTTY) io.err(`warning: ${flag} is deprecated\n`)
    },
    onChunk: streamingEligible
      ? async (chunk) => {
          streamed = true
          const value = outputFormat === 'jsonl' ? { type: 'chunk', data: chunk } : chunk
          const text = renderOutput(value, chunkFormat, state.outputRenderers, { stage: 'chunk' })
          await io.chunk(text.endsWith('\n') ? text : `${text}\n`)
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


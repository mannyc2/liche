import type { CliEvent, CliEventSubscription, CliState, Dict, Format, PrepareContextHook, RunContext, ServeOptions } from '../types.js'
import { execute } from './execute.js'
import { isRuntimeResult, ParseError } from '../errors/error.js'
import { formatCta, pick, renderOutput } from '../format/index.js'
import { parseGlobals } from '../parser/index.js'
import { commandFormat, outputPolicy, selectCommand } from '../command/registry.js'
import { renderHelp } from '../help/render.js'
import { commandContract } from '../command/contract.js'
import { complete, shells } from '../completions/shells.js'
import { formatHumanValidationError } from './human-validation-error.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from './lifecycle.js'

const DEFAULT_FORMAT: Format = 'json'

export async function serveCli(
  name: string,
  state: CliState,
  argv: string[],
  options: ServeOptions = {},
): Promise<void> {
  const io = {
    err: options.stderr ?? ((s: string) => void Bun.stderr.write(s)),
    out: options.stdout ?? ((s: string) => void Bun.stdout.write(s)),
  }
  const env = options.env ?? (Bun.env as Dict<string | undefined>)
  const isTty = options.isTty ?? process.stdout.isTTY === true
  const invocation = isCiEnv(env) ? 'ci' : 'cli'

  let flags
  try {
    flags = parseGlobals(argv, state.globals)
  } catch (error) {
    if (error instanceof ParseError) {
      await emitServeLifecycle(name, state, state.events, {
        agent: !isTty,
        error: { code: 'PARSE_ERROR', exitCode: 1 },
        exitCode: 1,
        format: state.def.format ?? DEFAULT_FORMAT,
        formatExplicit: false,
        invocation,
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
  const rootOutputFormat = flags.json ? 'json' : flags.format ?? state.def.format ?? DEFAULT_FORMAT
  const formatExplicit = !!(flags.formatExplicit || flags.json)
  const human = !flags.formatExplicit && !flags.json && isTty

  if (env['COMPLETE']) {
    if (!shells.includes(env['COMPLETE'] as any)) {
      await emitServeLifecycle(name, state, state.events, {
        agent: !isTty || formatExplicit,
        error: { code: 'PARSE_ERROR' },
        format: rootOutputFormat,
        formatExplicit,
        invocation,
        result: 'user_error',
        surface: { kind: 'completion' },
        type: 'parse.failed',
      })
      io.err(`Unknown completion shell '${env['COMPLETE']}'. Supported: ${shells.join(', ')}\n`)
      return
    }
    const suggestions = complete(state, flags.rest, Math.max(flags.rest.length - 1, 0))
    await emitServeLifecycle(name, state, state.events, {
      agent: !isTty || formatExplicit,
      completion: { shell: env['COMPLETE'], suggestionCount: suggestions.length },
      format: rootOutputFormat,
      formatExplicit,
      invocation,
      surface: { kind: 'completion' },
      type: 'completion.generated',
    })
    return io.out(`${suggestions.join('\n')}${suggestions.length ? '\n' : ''}`)
  }

  if (flags.version) {
    await emitServeLifecycle(name, state, state.events, {
      agent: !isTty || formatExplicit,
      format: rootOutputFormat,
      formatExplicit,
      invocation,
      surface: { kind: 'version' },
      type: 'version.rendered',
    })
    return io.out(`${state.def.version ?? '0.0.0'}\n`)
  }
  for (const handler of state.serveHandlers) {
    if (flags[handler.flagKey]) return await handler.handle({ binaryName: name, flags, options, state })
  }

  const selected = selectCommand(state, flags.rest)
  const outputFormat = flags.json ? 'json' : flags.format ?? (selected ? commandFormat(selected) : undefined) ?? state.def.format ?? DEFAULT_FORMAT
  if (!selected && flags.rest.some(isFlagLikeToken)) {
    await emitServeLifecycle(name, state, state.events, {
      agent: !isTty || formatExplicit,
      error: { code: 'PARSE_ERROR', exitCode: 1 },
      exitCode: 1,
      format: outputFormat,
      formatExplicit,
      invocation,
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
    await emitServeLifecycle(name, state, state.events, {
      agent: !isTty || formatExplicit,
      error: { code: 'COMMAND_NOT_FOUND' },
      format: outputFormat,
      formatExplicit,
      invocation,
      surface: { kind: 'command' },
      type: 'command.not_found',
    })
  }
  if (flags.help || !selected) {
    await emitServeLifecycle(name, state, selected ? state.events.concat(selected.events) : state.events, {
      agent: !isTty || formatExplicit,
      ...(selected ? { command: eventCommand(selected) } : undefined),
      format: outputFormat,
      formatExplicit,
      invocation,
      surface: { kind: 'help' },
      type: 'help.rendered',
    })
    return io.out(`${renderHelp(name, state, selected, flags.rest)}\n`)
  }
  if (flags.schema) {
    await emitServeLifecycle(name, state, state.events.concat(selected.events), {
      agent: !isTty || formatExplicit,
      command: eventCommand(selected),
      format: outputFormat,
      formatExplicit,
      invocation,
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
      await emitServeLifecycle(name, state, state.events.concat(selected.events), {
        agent: !isTty || formatExplicit,
        command: eventCommand(selected),
        error: { code: 'PARSE_ERROR', exitCode: 1 },
        exitCode: 1,
        format: outputFormat,
        formatExplicit,
        invocation,
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
  const streamingEligible = !flags.fullOutput && !flags.filterOutput && !transformsBuffering
  let streamed = false
  const chunkFormat: Format = outputFormat === 'jsonl' ? 'jsonl' : outputFormat

  const result = await execute(name, selected, {
    agent: !isTty || formatExplicit,
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
    invocation,
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
  const envelopeMode = state.def.generated?.machineOutput === 'envelope' && formatExplicit
  const machineErrorEnvelope = !result.ok && !human
  let data: unknown = flags.fullOutput || envelopeMode || machineErrorEnvelope ? result : result.ok ? result.data : result.error
  if (flags.filterOutput && result.ok) data = pick(data, flags.filterOutput)

  const rendered = renderOutput(data, outputFormat, state.outputRenderers, { stage: 'result' })
  let text = rendered
  for (const transform of state.outputTransforms) {
    text = transform.transform(text, { flags, format: outputFormat, stage: 'result' })
  }

  const suppressStreamedRecap = streamed && result.ok
  if (!(policy === 'agent-only' && human && result.ok && !flags.fullOutput) && !suppressStreamedRecap) io.out(text.endsWith('\n') ? text : `${text}\n`)
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

function contextGlobals(flags: Record<string, unknown>, state: CliState): Record<string, boolean | string | undefined> {
  const out: Record<string, boolean | string | undefined> = {}
  for (const global of state.globals) {
    if (global.expose !== 'context') continue
    const value = flags[global.key]
    if (typeof value === 'boolean' || typeof value === 'string') out[global.key] = value
  }
  return out
}

async function emitServeLifecycle(
  binaryName: string,
  state: CliState,
  subscriptions: readonly CliEventSubscription[],
  event: Omit<CliEvent, 'cli' | 'occurredAt'>,
): Promise<void> {
  await emitLifecycleEvent(subscriptions, createLifecycleEvent(binaryName, state.def.version, event))
}

async function runPrepareContext(
  hooks: readonly PrepareContextHook[],
  input: { name: string; env: Dict<string | undefined>; flags: Dict },
): Promise<Partial<RunContext>> {
  const overrides: Partial<RunContext> = {}
  for (const hook of hooks) {
    const result = await hook(input)
    if (!result) continue
    if (isRuntimeResult(result)) {
      if (!result.ok) throw new ParseError({ message: result.error.message ?? 'Prepare context failed' })
      continue
    }
    if (result.patch) Object.assign(overrides, result.patch)
  }
  return overrides
}

function isCiEnv(env: Dict<string | undefined>): boolean {
  const value = env['CI']
  if (value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false') {
    return true
  }
  return ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'TF_BUILD'].some((key) => {
    const v = env[key]
    return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
  })
}

function isFlagLikeToken(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

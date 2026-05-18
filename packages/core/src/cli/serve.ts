import type { CliState, Dict, Format, ServeOptions } from '../types.js'
import { execute } from './execute.js'
import { ParseError } from '../errors/error.js'
import { format, formatCta, pick, tokenCount, tokenSlice } from '../format/index.js'
import { loadConfig, parseGlobals } from '../parser/index.js'
import { outputPolicy, selectCommand } from '../command/registry.js'
import { renderHelp } from '../help/render.js'
import { commandSchema } from '../command/schema.js'
import { serveMcp } from '../mcp/stdio.js'
import { runBuiltin } from './builtins.js'
import { skillIndex, skillMarkdown } from '../skills/generate.js'
import { manifestEnvelope } from '../command/registry.js'
import { complete, shells } from '../completions/shells.js'
import { formatHumanValidationError } from './format-error.js'

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

  let flags
  try {
    flags = parseGlobals(argv, state.def.config?.flag, state.def.generated?.disabledGlobals)
  } catch (error) {
    if (error instanceof ParseError) {
      io.err(`Error (PARSE_ERROR): ${error.shortMessage}\n`)
      ;(options.exit ?? process.exit)(1)
      return
    }
    throw error
  }
  const outputFormat = flags.json ? 'json' : flags.format ?? state.def.format ?? 'toon'
  const human = !flags.formatExplicit && !flags.json && isTty

  if (env['COMPLETE']) {
    if (!shells.includes(env['COMPLETE'] as any)) {
      io.err(`Unknown completion shell '${env['COMPLETE']}'. Supported: ${shells.join(', ')}\n`)
      return
    }
    const suggestions = complete(state, flags.rest, Math.max(flags.rest.length - 1, 0))
    return io.out(`${suggestions.join('\n')}${suggestions.length ? '\n' : ''}`)
  }

  if (flags.version) return io.out(`${state.def.version ?? '0.0.0'}\n`)
  if (flags.mcp) return await serveMcp(name, state, options)
  if (await runBuiltin(name, state, flags, io, outputFormat, env as Record<string, string | undefined>)) return

  if (flags.llms) {
    const wantsStructured = flags.formatExplicit && outputFormat !== 'md'
    if (wantsStructured) {
      return io.out(`${format(manifestEnvelope(name, state), outputFormat)}\n`)
    }
    const value = flags.fullOutput ? skillMarkdown(name, state) : skillIndex(name, state)
    return io.out(`${format(value, 'md')}\n`)
  }

  const selected = selectCommand(state, flags.rest)
  if (flags.help || !selected) return io.out(`${renderHelp(name, state, selected, flags.rest)}\n`)
  if (flags.schema) return io.out(`${format(commandSchema(selected.entry), outputFormat)}\n`)

  let configLoaded
  try {
    configLoaded = await loadConfig(name, state, flags)
  } catch (error) {
    if (error instanceof ParseError) {
      io.err(`Error (PARSE_ERROR): ${error.shortMessage}\n`)
      ;(options.exit ?? process.exit)(1)
      return
    }
    throw error
  }

  const formatExplicit = !!(flags.formatExplicit || flags.json)
  const policy = outputPolicy(selected) ?? state.def.outputPolicy ?? 'all'
  const streamingEligible = !flags.fullOutput && !flags.filterOutput && !flags.tokenCount && flags.tokenLimit === undefined && !flags.tokenOffset
  let streamed = false
  const chunkFormat: Format = outputFormat === 'jsonl' ? 'jsonl' : outputFormat

  const result = await execute(name, selected, {
    agent: !isTty || formatExplicit,
    argvOptions: selected.argv,
    config: configLoaded,
    displayName: name,
    env,
    format: outputFormat,
    formatExplicit,
    middlewares: state.middlewares.concat(selected.middlewares),
    onDeprecation: (flag) => {
      if (isTty) io.err(`warning: ${flag} is deprecated\n`)
    },
    onChunk: streamingEligible
      ? (chunk) => {
          streamed = true
          const value = outputFormat === 'jsonl' ? { type: 'chunk', data: chunk } : chunk
          const text = format(value, chunkFormat)
          io.out(text.endsWith('\n') ? text : `${text}\n`)
        }
      : undefined,
  })

  const exitCode = result.ok ? 0 : Number(result.error.exitCode ?? 1)
  const envelopeMode = state.def.generated?.machineOutput === 'envelope' && formatExplicit
  let data: unknown = flags.fullOutput || envelopeMode ? result : result.ok ? result.data : result.error
  if (flags.filterOutput && result.ok) data = pick(data, flags.filterOutput)

  let text = flags.tokenCount ? String(tokenCount(format(data, outputFormat))) : format(data, outputFormat)
  if (flags.tokenLimit !== undefined || flags.tokenOffset) text = tokenSlice(text, flags.tokenOffset ?? 0, flags.tokenLimit ?? Infinity)

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

import { defineCommand, defineExtension, z } from '@liche/core'
import type { CliEvent, CliEventSubscriber, CliEventType, CliExtension } from '@liche/core'
import { createRedactionPolicy, type StringRule } from './internal/redact.js'
import { createValidator, type WireEvent } from './internal/schema.js'
import { resolveConsent, type Invocation } from './internal/consent.js'
import { consoleSink, wrapSink, type TelemetrySink, type WrappedSink } from './internal/sinks.js'

export { jsonlFileSink, httpSink, consoleSink, noopSink, wrapSink } from './internal/sinks.js'
export type { TelemetrySink, JsonlFileSinkOptions, HttpSinkOptions, ConsoleSinkOptions } from './internal/sinks.js'
export type { WireEvent } from './internal/schema.js'
export type { Invocation } from './internal/consent.js'

const SDK_NAME = '@liche/telemetry'
const SDK_VERSION = '1.0.0'

const TERMINAL_EVENTS: ReadonlySet<CliEventType> = new Set([
  'command.completed',
  'command.failed',
  'validation.failed',
  'parse.failed',
  'command.not_found',
  'hook.failed',
])

const ESSENTIAL: ReadonlyArray<CliEventType> = [
  'command.started',
  'command.completed',
  'command.failed',
  'validation.failed',
  'parse.failed',
  'command.not_found',
  'hook.failed',
]
const ERRORS_ONLY: ReadonlyArray<CliEventType> = [
  'command.failed',
  'validation.failed',
  'parse.failed',
  'command.not_found',
  'hook.failed',
]
const ALL_COMMANDS: ReadonlyArray<CliEventType> = [
  'command.started',
  'command.completed',
  'command.failed',
  'validation.failed',
  'parse.failed',
  'command.not_found',
  'hook.failed',
  'command.selected',
]

export type TelemetryPreset = 'essential' | 'all-commands' | 'errors-only' | 'all'
export type TelemetryEnv = Record<string, string | undefined>
export type TelemetryEnvSource = TelemetryEnv | (() => TelemetryEnv)

export type TelemetryOptions = {
  readonly enabledEnvVar?: string
  readonly cliEnabledEnvVar?: string
  readonly respectDoNotTrack?: boolean
  readonly invocations?: ReadonlyArray<Invocation>

  readonly sinks?: ReadonlyArray<TelemetrySink>
  readonly events?: TelemetryPreset | ReadonlyArray<CliEventType>

  readonly extraSecretKeys?: ReadonlyArray<RegExp>
  readonly extraStringPatterns?: ReadonlyArray<RegExp | StringRule>
  readonly redactor?: (value: unknown) => unknown

  readonly sessionId?: string | (() => string)
  readonly runId?: string | (() => string)

  readonly validate?: boolean
  readonly debug?: boolean | 'stderr'

  readonly flushTimeoutMs?: number
  readonly env?: TelemetryEnvSource
  readonly warn?: (message: string) => void
}

function resolveAllowedTypes(events: TelemetryOptions['events']): ReadonlyArray<CliEventType> | '*' {
  if (events === undefined || events === 'essential') return ESSENTIAL
  if (events === 'all') return '*'
  if (events === 'all-commands') return ALL_COMMANDS
  if (events === 'errors-only') return ERRORS_ONLY
  return events
}

function readEnv(options: TelemetryOptions): TelemetryEnv {
  if (typeof options.env === 'function') return options.env()
  if (options.env) return options.env
  return (typeof Bun !== 'undefined' ? Bun.env : process.env) as TelemetryEnv
}

export function telemetry(options: TelemetryOptions = {}): CliExtension {
  const initialEnv = readEnv(options)
  const currentEnv = (): TelemetryEnv => readEnv(options)
  const allowedTypes = resolveAllowedTypes(options.events)
  const allowedInvocations = options.invocations ?? (['cli'] as const)
  const flushTimeoutMs = options.flushTimeoutMs ?? 2000
  const validateOn = options.validate !== false
  const sessionFn =
    typeof options.sessionId === 'function'
      ? options.sessionId
      : typeof options.sessionId === 'string'
        ? (): string => options.sessionId as string
        : (): string => crypto.randomUUID()
  const runFn =
    typeof options.runId === 'function'
      ? options.runId
      : typeof options.runId === 'string'
        ? (): string => options.runId as string
        : sessionFn
  const sessionId = sessionFn()
  const runId = runFn()

  const policy = createRedactionPolicy({
    ...(options.extraSecretKeys && { extraSecretKeys: options.extraSecretKeys }),
    ...(options.extraStringPatterns && { extraStringPatterns: options.extraStringPatterns }),
    ...(options.redactor && { redactor: options.redactor }),
  })

  const validator = createValidator({ ...(options.warn && { warn: options.warn }) })

  const debugSink =
    options.debug === 'stderr' || options.debug === true || initialEnv['LICHE_TELEMETRY_DEBUG'] === 'stderr'
      ? [consoleSink({ stream: 'stderr' })]
      : []
  const baseSinks: ReadonlyArray<TelemetrySink> = [...(options.sinks ?? []), ...debugSink]
  const wrappedSinks: ReadonlyArray<WrappedSink> = baseSinks.map((s) =>
    wrapSink(s, { onError: (name, err) => (options.warn ?? defaultWarn)(`[telemetry] sink=${name} error=${describeError(err)}`) }),
  )

  const runtime = {
    name: 'bun',
    version: typeof Bun !== 'undefined' ? Bun.version : 'unknown',
    platform: process.platform,
    arch: process.arch,
  }

  const enrich = (event: CliEvent): WireEvent =>
    ({
      ...event,
      telemetry: {
        schemaVersion: 1,
        sessionId,
        runId,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
        runtime,
      },
    }) as WireEvent

  const dispatcher: CliEventSubscriber = async (event) => {
    if (allowedTypes !== '*' && !allowedTypes.includes(event.type)) return
    const consent = resolveConsent({
      env: currentEnv(),
      cliName: event.cli.name,
      invocation: event.invocation,
      ...(options.enabledEnvVar !== undefined && { enabledEnvVar: options.enabledEnvVar }),
      ...(options.cliEnabledEnvVar !== undefined && { cliEnabledEnvVar: options.cliEnabledEnvVar }),
      ...(options.respectDoNotTrack !== undefined && { respectDoNotTrack: options.respectDoNotTrack }),
      allowedInvocations,
    })
    if (!consent.enabled) return

    const redacted = policy.redact(event) as CliEvent
    const enriched = enrich(redacted)

    if (validateOn) {
      const result = validator.parse(enriched)
      if (!result.ok) return
    }

    await Promise.allSettled(wrappedSinks.map((s) => s.emit(enriched)))

    if (TERMINAL_EVENTS.has(event.type)) {
      await Promise.allSettled(wrappedSinks.map((s) => (s.flush ? s.flush(flushTimeoutMs) : undefined)))
    }
  }

  return defineExtension({
    id: 'liche.telemetry',
    events: [{ target: '*', subscriber: dispatcher }],
    commands: buildSubcommands(options, currentEnv),
  })
}

// ─── subcommands ────────────────────────────────────────────────────────────────

const inspectArgs = z.object({})
const enableDisableArgs = z.object({})
const passthroughEnv = z.record(z.string(), z.string().optional())

function buildSubcommands(options: TelemetryOptions, currentEnv: () => TelemetryEnv) {
  return [
    defineCommand({
      agent: false,
      description: 'Show resolved telemetry state for the current environment',
      path: ['telemetry', 'status'],
      input: { args: enableDisableArgs, env: passthroughEnv },
      output: z.object({
        enabled: z.boolean(),
        reason: z.string(),
        source: z.string().optional(),
        invocation: z.string(),
      }),
      safety: { readOnly: true },
      run: ({ ctx, input }) => {
        const runtimeEnv = { ...currentEnv(), ...(input.env as TelemetryEnv) }
        const consent = resolveConsent({
          env: runtimeEnv,
          cliName: ctx.name,
          invocation: ctx.invocation,
          ...(options.enabledEnvVar !== undefined && { enabledEnvVar: options.enabledEnvVar }),
          ...(options.cliEnabledEnvVar !== undefined && { cliEnabledEnvVar: options.cliEnabledEnvVar }),
          ...(options.respectDoNotTrack !== undefined && { respectDoNotTrack: options.respectDoNotTrack }),
          allowedInvocations: options.invocations ?? ['cli'],
        })
        return {
          enabled: consent.enabled,
          reason: consent.reason,
          ...(consent.source && { source: consent.source }),
          invocation: ctx.invocation,
        }
      },
    }),
    defineCommand({
      agent: false,
      description: 'Print the env var to set to enable telemetry',
      path: ['telemetry', 'enable'],
      input: { args: enableDisableArgs },
      output: z.object({ instructions: z.string(), envVar: z.string() }),
      safety: { readOnly: true },
      run: ({ ctx }) => {
        const envVar = cliVarFromName(ctx.name, options.cliEnabledEnvVar)
        return {
          envVar,
          instructions: `To enable telemetry for ${ctx.name}, set:\n\n  export ${envVar}=1\n\nThis is picked up on the next invocation. DO_NOT_TRACK and ${options.enabledEnvVar ?? 'LICHE_TELEMETRY'}=0 still override this.`,
        }
      },
    }),
    defineCommand({
      agent: false,
      description: 'Print the env var to set to disable telemetry',
      path: ['telemetry', 'disable'],
      input: { args: enableDisableArgs },
      output: z.object({ instructions: z.string(), envVar: z.string() }),
      safety: { readOnly: true },
      run: ({ ctx }) => {
        const envVar = cliVarFromName(ctx.name, options.cliEnabledEnvVar)
        return {
          envVar,
          instructions: `To disable telemetry for ${ctx.name}, set any of:\n\n  export ${envVar}=0\n  export ${options.enabledEnvVar ?? 'LICHE_TELEMETRY'}=0\n  export DO_NOT_TRACK=1`,
        }
      },
    }),
    defineCommand({
      agent: false,
      description: 'Print instructions for inspecting telemetry wire events without sending them',
      path: ['telemetry', 'inspect'],
      input: { args: inspectArgs },
      output: z.object({ instructions: z.string() }),
      safety: { readOnly: true },
      run: () => ({
        instructions: `To inspect wire events without sending them to configured sinks:\n\n  export LICHE_TELEMETRY_DEBUG=stderr\n  # run your command — events are printed to stderr prefixed with "[telemetry]"\n\nThis adds a stderr sink alongside any others; secrets are redacted before printing.`,
      }),
    }),
  ]
}

function cliVarFromName(name: string, override: string | undefined): string {
  if (override) return override
  return `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TELEMETRY`
}

function defaultWarn(message: string): void {
  console.warn(message)
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

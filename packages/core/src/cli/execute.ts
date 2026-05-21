import type {
  CliEvent,
  CliEventError,
  CliEventSubscription,
  CliHooks,
  CommandError,
  Dict,
  Format,
  GlobalOptions,
  InvocationKind,
  MiddlewareContext,
  MiddlewareHandler,
  Result,
  SelectedCommand,
  ConfigValueSource,
  OptionValueSource,
} from '../types.js'
import { LiliError, errorToObject } from '../errors/error.js'
import { callFetch } from '../fetch/curl.js'
import type { LoadedConfig } from '../parser/config.js'
import { parseArgs, parseCommandOptions, parseObject } from '../parser/argv.js'
import { isFetch, isResult } from '../command/guards.js'
import { collectAsync, isAsyncIterable } from '../internal.js'
import { parseSchema } from '../schema/zod.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand } from './lifecycle.js'

export type ExecuteInput = {
  agent: boolean
  argvOptions: { args: string[]; argsObject?: Dict | undefined; options?: Dict | undefined }
  config?: LoadedConfig | undefined
  displayName: string
  env: Dict
  format: Format
  formatExplicit: boolean
  global?: GlobalOptions | undefined
  hooks: CliHooks
  invocation: InvocationKind
  isTty?: boolean | undefined
  middlewares: MiddlewareHandler[]
  events: CliEventSubscription[]
  onChunk?: ((chunk: unknown) => void | Promise<void>) | undefined
  onDeprecation?: ((flag: string, option: string) => void) | undefined
  version?: string | undefined
}

export async function execute(binaryName: string, selected: SelectedCommand, input: ExecuteInput): Promise<Result> {
  const command = eventCommand(selected)
  const startedAt = Date.now()
  await emitCommandEvent(binaryName, input, command, 'command.selected')
  await emitCommandEvent(binaryName, input, command, 'command.started')

  const definition = selected.entry as any

  try {
    if (isFetch(selected.entry)) {
      const result = await callFetch(selected.entry, selected.argv.args)
      await emitResultEvent(binaryName, input, command, startedAt, result)
      return result
    }

    const argv = parseCommandOptions(definition, input.argvOptions.args, input.argvOptions.options)
    if (input.onDeprecation) for (const { flag, option } of argv.deprecations) input.onDeprecation(flag, option)
    const configOptions = optionsFromConfigBindings(definition.optionConfig, input.config)
    const fromEnv: Dict = {}
    for (const [optKey, envName] of Object.entries(definition.optionEnv ?? {}) as [string, string][]) {
      const value = input.env[envName]
      if (value !== undefined) fromEnv[optKey] = value
    }
    const options = parseObject(definition.options, { ...configOptions.values, ...fromEnv, ...argv.options })
    const args = input.argvOptions.argsObject !== undefined
      ? parseObject(definition.args, input.argvOptions.argsObject)
      : parseArgs(definition.args, argv.args)
    const env = parseObject(definition.env, input.env)
    const vars = parseObject((selected.rootDef as any)?.vars, {})

    const context: MiddlewareContext = {
      agent: input.agent,
      args: args as Dict,
      config: (input.config?.values ?? {}) as Dict,
      displayName: input.displayName,
      env: env as Dict,
      error(error) {
        throw new Done({
          ok: false,
          error: {
            code: error.code,
            exitCode: error.exitCode ?? 1,
            ...(error.hint !== undefined ? { hint: error.hint } : undefined),
            message: error.message,
            retryable: error.retryable,
          },
          meta: error.cta ? { cta: error.cta } : undefined,
        })
      },
      format: input.format,
      formatExplicit: input.formatExplicit,
      global: input.global ?? {},
      invocation: input.invocation,
      isTty: input.isTty ?? false,
      name: binaryName,
      ok(data, meta) {
        throw new Done({ ok: true, data, ...(meta && Object.keys(meta).length > 0 ? { meta } : {}) })
      },
      options: options as Dict,
      set(key, value) {
        ;(this.var as Dict)[key] = value
      },
      sources: {
        config(path) {
          return sourceForConfigPath(input.config, path)
        },
        option(name) {
          return sourceForOption(name, argv.options, fromEnv, configOptions.sources)
        },
      },
      var: vars as Dict,
    }

    for (const hook of input.hooks.beforeExecute) {
      try {
        await hook(context)
      } catch (error) {
        await emitCommandEvent(binaryName, input, command, 'hook.failed', { error: eventError(errorToObject(error)) })
        throw error
      }
    }

    const result = await runStack(context, [...input.middlewares, ...(definition.middleware ?? [])], async () => {
      if (!definition.run) throw new LiliError({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no run handler' })
      return await definition.run(context)
    })

    if (isAsyncIterable(result)) {
      if (input.onChunk) {
        const collected: unknown[] = []
        for await (const chunk of result) {
          collected.push(chunk)
          await input.onChunk(chunk)
        }
        const completed = { ok: true, data: collected } satisfies Result
        await emitResultEvent(binaryName, input, command, startedAt, completed)
        return completed
      }
      const completed = { ok: true, data: await collectAsync(result) } satisfies Result
      await emitResultEvent(binaryName, input, command, startedAt, completed)
      return completed
    }
    if (isResult(result)) {
      await emitResultEvent(binaryName, input, command, startedAt, result)
      return result
    }

    const data = parseSchema(definition.output, result, result)
    const completed = { ok: true, data } satisfies Result
    await emitResultEvent(binaryName, input, command, startedAt, completed)
    return completed
  } catch (error) {
    const result: Result = error instanceof Done ? error.result : { ok: false, error: errorToObject(error) }
    if (!result.ok && result.error.code === 'VALIDATION_ERROR') {
      await emitCommandEvent(binaryName, input, command, 'validation.failed', { error: eventError(result.error) })
    }
    await emitResultEvent(binaryName, input, command, startedAt, result)
    return result
  }
}

class Done {
  constructor(public result: Result) {}
}

async function runStack(
  context: MiddlewareContext,
  middlewares: MiddlewareHandler[],
  handler: () => Promise<unknown>,
  index = 0,
): Promise<unknown> {
  if (index >= middlewares.length) return await handler()

  let downstream: unknown
  const result = await middlewares[index]!(context, async () => {
    downstream = await runStack(context, middlewares, handler, index + 1)
  })
  return result ?? downstream
}

async function emitCommandEvent(
  binaryName: string,
  input: ExecuteInput,
  command: NonNullable<CliEvent['command']>,
  type: CliEvent['type'],
  extra: Partial<CliEvent> = {},
): Promise<void> {
  await emitLifecycleEvent(input.events, createLifecycleEvent(binaryName, input.version, {
    agent: input.agent,
    command,
    format: input.format,
    formatExplicit: input.formatExplicit,
    invocation: input.invocation,
    surface: { kind: 'command' },
    type,
    ...extra,
  }))
}

async function emitResultEvent(
  binaryName: string,
  input: ExecuteInput,
  command: NonNullable<CliEvent['command']>,
  startedAt: number,
  result: Result,
): Promise<void> {
  const durationMs = Date.now() - startedAt
  if (result.ok) {
    await emitCommandEvent(binaryName, input, command, 'command.completed', {
      durationMs,
      exitCode: 0,
      result: 'success',
    })
    return
  }

  const exitCode = Number(result.error.exitCode ?? 1)
  await emitCommandEvent(binaryName, input, command, 'command.failed', {
    durationMs,
    error: eventError(result.error),
    exitCode,
    result: result.error.code === 'UNKNOWN' ? 'system_error' : 'user_error',
  })
}

function eventError(error: CommandError): CliEventError {
  return {
    code: error.code,
    ...(error.exitCode !== undefined ? { exitCode: Number(error.exitCode) } : undefined),
    ...(error.fieldErrors !== undefined ? { fieldErrorCount: error.fieldErrors.length } : undefined),
    ...(error.retryable !== undefined ? { retryable: error.retryable } : undefined),
    ...(error.status !== undefined ? { status: error.status } : undefined),
  }
}

function optionsFromConfigBindings(
  bindings: Record<string, string> | undefined,
  config: LoadedConfig | undefined,
): { values: Dict; sources: Map<string, ConfigValueSource> } {
  const values: Dict = {}
  const sources = new Map<string, ConfigValueSource>()
  if (!bindings || !config) return { values, sources }
  for (const [optionName, configPath] of Object.entries(bindings)) {
    const value = getPath(config.values, configPath)
    if (value === undefined) continue
    values[optionName] = value
    sources.set(optionName, sourceForConfigPath(config, configPath))
  }
  return { values, sources }
}

function getPath(value: unknown, path: string): unknown {
  let cursor = value as any
  for (const part of path.split('.')) {
    if (!part) continue
    cursor = cursor?.[part]
  }
  return cursor
}

function sourceForConfigPath(config: LoadedConfig | undefined, path: string): ConfigValueSource {
  return config?.sources.get(path) ?? { kind: 'default' }
}

function sourceForOption(
  name: string,
  argvOptions: Dict,
  fromEnv: Dict,
  configSources: Map<string, ConfigValueSource>,
): OptionValueSource {
  if (Object.prototype.hasOwnProperty.call(argvOptions, name)) return 'argv'
  if (Object.prototype.hasOwnProperty.call(fromEnv, name)) return 'env'
  const source = configSources.get(name)
  if (source) return optionSourceFromConfigSource(source)
  return 'default'
}

function optionSourceFromConfigSource(source: ConfigValueSource): OptionValueSource {
  if (source.kind === 'explicit-file') return 'explicit-config'
  if (source.kind === 'project-file') return 'project-config'
  if (source.kind === 'user-file') return 'user-config'
  return 'default'
}

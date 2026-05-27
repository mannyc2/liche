import type {
  CliEvent,
  CliEventError,
  CliEventSubscription,
  CliHooks,
  CommandError,
  Dict,
  Format,
  GlobalOptions,
  InputSourceProvider,
  MiddlewareContext,
  MiddlewareHandler,
  Result,
  RunContext,
  SelectedCommand,
} from '../types.js'
import { fail, isRuntimeResult, LicheError, ok, toCommandError } from '../errors/error.js'
import { isCommand } from '../command/guards.js'
import { collectAsync, isAsyncIterable } from '../internal.js'
import { attachOutputSource, parseSchemaAsync } from '../schema/zod.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand } from './lifecycle.js'
import { resolveCommandInput, type InputSourceHints } from './input-sources.js'

export type ExecuteInput = {
  argvOptions: { args: string[]; argsObject?: Dict | undefined; options?: Dict | undefined }
  contextOverrides?: Partial<RunContext> | undefined
  displayName: string
  env: Dict
  format: Format
  formatExplicit: boolean
  flags?: Dict | undefined
  global?: GlobalOptions | undefined
  hooks: CliHooks
  inputSources?: readonly InputSourceProvider[] | undefined
  inputSourceHints?: InputSourceHints | undefined
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

  try {
    if (!isCommand(selected.entry)) {
      throw new LicheError({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no run handler' })
    }
    const runtime = selected.entry.runtime

    const overrides = input.contextOverrides ?? {}

    const resolved = await resolveCommandInput({
      argvOptions: input.argvOptions,
      commandPath: selected.path,
      env: input.env as Dict<string | undefined>,
      flags: input.flags ?? {},
      inputSources: input.inputSources ?? [],
      inputSourceHints: input.inputSourceHints,
      onDeprecation: input.onDeprecation,
      rootVarsSchema: (selected.rootDef as any)?.vars,
      runtime,
    })

    const baseContext: MiddlewareContext = {
      args: resolved.args as Dict,
      displayName: input.displayName,
      env: resolved.env as Dict,
      error(error) {
        return fail(error)
      },
      format: input.format,
      formatExplicit: input.formatExplicit,
      global: input.global ?? {},
      isTty: input.isTty ?? false,
      name: binaryName,
      ok(data, meta) {
        return ok(data, meta)
      },
      options: resolved.options as Dict,
      set(key, value) {
        ;(this.var as Dict)[key] = value
      },
      sources: resolved.sources,
      var: resolved.vars as Dict,
    }

    const context: MiddlewareContext = { ...baseContext, ...overrides }

    for (const hook of input.hooks.beforeExecute) {
      try {
        const hookResult = await hook(context)
        if (isRuntimeResult(hookResult)) {
          if (!hookResult.ok) {
            await emitCommandEvent(binaryName, input, command, 'hook.failed', { error: eventError(hookResult.error) })
          }
          await emitResultEvent(binaryName, input, command, startedAt, hookResult)
          return hookResult
        }
      } catch (error) {
        await emitCommandEvent(binaryName, input, command, 'hook.failed', { error: eventError(toCommandError(error)) })
        throw error
      }
    }

    const result = await runStack(context, [...input.middlewares, ...(runtime.middleware ?? [])], async () => {
      if (!runtime.run) throw new LicheError({ code: 'COMMAND_NOT_RUNNABLE', message: 'Command has no run handler' })
      return await runtime.run(context)
    })

    if (isRuntimeResult(result)) {
      await emitResultEvent(binaryName, input, command, startedAt, result)
      return result
    }

    if (isAsyncIterable(result)) {
      if (input.onChunk) {
        const collected: unknown[] = []
        for await (const chunk of result) {
          collected.push(chunk)
          await input.onChunk(chunk)
        }
        const completed = ok(collected)
        await emitResultEvent(binaryName, input, command, startedAt, completed)
        return completed
      }
      const completed = ok(await collectAsync(result))
      await emitResultEvent(binaryName, input, command, startedAt, completed)
      return completed
    }
    let data: unknown
    try {
      data = await parseSchemaAsync(runtime.output, result, result)
    } catch (outputError) {
      throw attachOutputSource(outputError)
    }
    const completed = ok(data)
    await emitResultEvent(binaryName, input, command, startedAt, completed)
    return completed
  } catch (error) {
    const result = fail(toCommandError(error))
    if (!result.ok && result.error.code === 'VALIDATION_ERROR') {
      await emitCommandEvent(binaryName, input, command, 'validation.failed', { error: eventError(result.error) })
    }
    await emitResultEvent(binaryName, input, command, startedAt, result)
    return result
  }
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
    isTty: input.isTty ?? false,
    command,
    format: input.format,
    formatExplicit: input.formatExplicit,
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

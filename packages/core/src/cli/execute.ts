import type { Dict, Format, InvocationKind, MiddlewareContext, MiddlewareHandler, Result, SelectedCommand } from '../types.js'
import { LiliError, errorToObject } from '../errors/error.js'
import { callFetch } from '../fetch/curl.js'
import { commandConfig } from '../parser/config.js'
import { parseArgs, parseCommandOptions, parseObject } from '../parser/argv.js'
import { isFetch, isResult } from '../command/guards.js'
import { collectAsync, isAsyncIterable } from '../internal.js'
import { parseSchema } from '../schema/zod.js'

export type ExecuteInput = {
  agent: boolean
  argvOptions: { args: string[]; argsObject?: Dict | undefined; options?: Dict | undefined }
  config?: Dict | undefined
  displayName: string
  env: Dict
  format: Format
  formatExplicit: boolean
  invocation: InvocationKind
  middlewares: MiddlewareHandler[]
  onChunk?: ((chunk: unknown) => void | Promise<void>) | undefined
  onDeprecation?: ((flag: string, option: string) => void) | undefined
}

export async function execute(binaryName: string, selected: SelectedCommand, input: ExecuteInput): Promise<Result> {
  if (isFetch(selected.entry)) return await callFetch(selected.entry, selected.argv.args)

  const definition = selected.entry as any

  try {
    const argv = parseCommandOptions(definition, input.argvOptions.args, input.argvOptions.options)
    if (input.onDeprecation) for (const { flag, option } of argv.deprecations) input.onDeprecation(flag, option)
    const config = commandConfig(input.config, selected.path)
    const fromEnv: Dict = {}
    for (const [optKey, envName] of Object.entries(definition.optionEnv ?? {}) as [string, string][]) {
      const value = input.env[envName]
      if (value !== undefined) fromEnv[optKey] = value
    }
    const options = parseObject(definition.options, { ...(config as any).options, ...fromEnv, ...argv.options })
    const args = input.argvOptions.argsObject !== undefined
      ? parseObject(definition.args, input.argvOptions.argsObject)
      : parseArgs(definition.args, argv.args)
    const env = parseObject(definition.env, input.env)
    const vars = parseObject((selected.rootDef as any)?.vars, {})

    const context: MiddlewareContext = {
      agent: input.agent,
      args: args as Dict,
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
      invocation: input.invocation,
      name: binaryName,
      ok(data, meta) {
        throw new Done({ ok: true, data, ...(meta && Object.keys(meta).length > 0 ? { meta } : {}) })
      },
      options: options as Dict,
      set(key, value) {
        ;(this.var as Dict)[key] = value
      },
      var: vars as Dict,
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
        return { ok: true, data: collected }
      }
      return { ok: true, data: await collectAsync(result) }
    }
    if (isResult(result)) return result

    const data = parseSchema(definition.output, result, result)
    return { ok: true, data }
  } catch (error) {
    if (error instanceof Done) return error.result
    return { ok: false, error: errorToObject(error) }
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

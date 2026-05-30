import type {
  CommandRuntime,
  Dict,
  FieldErrorSource,
  InputSourceProvider,
  InputSourceProvenance,
  OptionValueSource,
  ResolvedInputSource,
  Schema,
  SourceInspector,
} from '../types.js'
import { ParseError } from '../errors/error.js'
import { attachFieldSources, isObjectSchema, objectShape, primitiveKind } from '../schema/zod.js'
import { parseArgsAsync, parseCommandOptions, parseObjectAsync } from '../parser/argv.js'

export type InputSourceHints = {
  args?: Record<string, FieldErrorSource> | undefined
  options?: Record<string, FieldErrorSource> | undefined
  env?: Record<string, FieldErrorSource> | undefined
}

export type ResolveCommandInputOptions = {
  argvOptions: { args: string[]; argsObject?: Dict | undefined; options?: Dict | undefined }
  commandPath: readonly string[]
  env: Dict<string | undefined>
  flags: Dict
  inputSources: readonly InputSourceProvider[]
  inputSourceHints?: InputSourceHints | undefined
  onDeprecation?: ((flag: string, option: string) => void) | undefined
  runtime: CommandRuntime
}

export type ResolvedCommandInput = {
  args: unknown
  env: unknown
  options: unknown
  sources: SourceInspector
}

const MISSING_SOURCE: InputSourceProvenance = { kind: 'missing' }
const DEFAULT_OPTION_SOURCE: OptionValueSource = { kind: 'default' }

export async function resolveCommandInput(input: ResolveCommandInputOptions): Promise<ResolvedCommandInput> {
  const argv = parseCommandOptions(input.runtime, input.argvOptions.args, input.argvOptions.options)
  if (input.onDeprecation) {
    for (const { flag, option } of argv.deprecations) input.onDeprecation(flag, option)
  }

  const providers = await resolveProviders(input)
  const optionSources = new Map<string, OptionValueSource>()
  for (const key of argv.explicitOptions) optionSources.set(key, { kind: 'argv' })

  const rawOptions: Dict = { ...argv.options }
  const optionShape = objectShape(input.runtime.options)
  for (const [optionName, bindings] of Object.entries(input.runtime.sources?.options ?? {})) {
    if (argv.explicitOptions.has(optionName)) continue
    for (const binding of bindings) {
      const provider = providers.get(binding.provider)
      if (!provider) {
        throw new ParseError({ message: `Input source provider not registered: ${binding.provider}` })
      }
      const raw = provider.get(binding.path)
      if (raw === undefined) continue
      rawOptions[optionName] = coerceSourceValue(
        optionName,
        binding.provider,
        binding.path,
        optionShape[optionName],
        raw,
      )
      optionSources.set(optionName, {
        kind: 'provider',
        path: binding.path,
        provider: binding.provider,
        source: provider.source(binding.path),
      })
      break
    }
  }

  const envBag = assembleDeclaredEnv(providers.get('env'), input.runtime.env, input.env)

  const hints = input.inputSourceHints ?? {}
  const optionsByKey = buildOptionsSourceMap({
    argvOptionSources: argv.optionSources,
    seedKeys: Object.keys(input.argvOptions.options ?? {}),
    providerKeys: Object.keys(input.runtime.sources?.options ?? {}).filter(
      (k) => !argv.explicitOptions.has(k) && rawOptions[k] !== undefined,
    ),
    sourcesByProvider: optionSources,
    hints: hints.options,
  })
  const envByKey = buildEnvSourceMap(input.runtime.env, envBag, hints.env)
  const argsByKey = buildArgsSourceMap({
    schema: input.runtime.args,
    argvArgs: argv.args,
    argsObject: input.argvOptions.argsObject,
    hints: hints.args,
  })

  const args = await runWithSources(argsByKey, () =>
    input.argvOptions.argsObject !== undefined
      ? parseObjectAsync(input.runtime.args, input.argvOptions.argsObject)
      : parseArgsAsync(input.runtime.args, argv.args),
  )
  const env = await runWithSources(envByKey, () => parseObjectAsync(input.runtime.env, envBag))
  const options = await runWithSources(optionsByKey, () => parseObjectAsync(input.runtime.options, rawOptions))

  return {
    args,
    env,
    options,
    sources: buildSourceInspector(providers, optionSources),
  }
}

async function runWithSources(
  sourcesByKey: Record<string, FieldErrorSource>,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await fn()
  } catch (error) {
    throw attachFieldSources(error, sourcesByKey)
  }
}

function buildOptionsSourceMap(args: {
  argvOptionSources: Map<string, FieldErrorSource>
  seedKeys: string[]
  providerKeys: string[]
  sourcesByProvider: Map<string, OptionValueSource>
  hints: Record<string, FieldErrorSource> | undefined
}): Record<string, FieldErrorSource> {
  const map: Record<string, FieldErrorSource> = {}
  // 1. Argv-explicit flags (the parser recorded the flag form).
  for (const [key, source] of args.argvOptionSources) map[key] = source
  // 2. Seeded keys from explicit `options` passed in to parseCommandOptions.
  //    These are synthetic input (e.g., from a programmatic execute() call) —
  //    they did NOT come from argv flag parsing, so they must not be tagged
  //    with a fabricated `--key` flag.
  for (const key of args.seedKeys) {
    if (args.argvOptionSources.has(key)) continue
    map[key] = { kind: 'programmatic', key }
  }
  // 3. Provider-bound options.
  for (const key of args.providerKeys) {
    const opt = args.sourcesByProvider.get(key)
    if (opt && opt.kind === 'provider') {
      map[key] = { kind: 'provider', provider: opt.provider, path: opt.path }
    }
  }
  // 4. Adapter-supplied hints (fetch/MCP) override everything.
  if (args.hints) for (const [key, source] of Object.entries(args.hints)) map[key] = source
  return map
}

function buildEnvSourceMap(
  schema: Schema | undefined,
  envBag: Dict<unknown>,
  hints: Record<string, FieldErrorSource> | undefined,
): Record<string, FieldErrorSource> {
  const map: Record<string, FieldErrorSource> = {}
  if (schema) {
    if (isObjectSchema(schema)) {
      for (const key of Object.keys(objectShape(schema))) map[key] = { kind: 'env', name: key }
    } else {
      for (const key of Object.keys(envBag)) map[key] = { kind: 'env', name: key }
    }
  }
  if (hints) for (const [key, source] of Object.entries(hints)) map[key] = source
  return map
}

function buildArgsSourceMap(args: {
  schema: Schema | undefined
  argvArgs: string[]
  argsObject: Dict | undefined
  hints: Record<string, FieldErrorSource> | undefined
}): Record<string, FieldErrorSource> {
  const map: Record<string, FieldErrorSource> = {}
  if (args.argsObject !== undefined) {
    // argsObject is synthetic input — keys are never positional argv tokens.
    // Default each key to programmatic; adapter hints (e.g., MCP extension)
    // can override below.
    for (const key of Object.keys(args.argsObject)) {
      map[key] = { kind: 'programmatic', key }
    }
  } else if (args.schema) {
    if (isObjectSchema(args.schema)) {
      Object.keys(objectShape(args.schema)).forEach((key, index) => {
        if (args.argvArgs[index] !== undefined) {
          map[key] = { kind: 'argv', positional: index }
        }
      })
    } else if (args.argvArgs.length > 0) {
      // Bare-positional schema decodes values[0] directly; error path is '$'.
      map[''] = { kind: 'argv', positional: 0 }
    }
  }
  if (args.hints) for (const [key, source] of Object.entries(args.hints)) map[key] = source
  return map
}

function assembleDeclaredEnv(
  envProviderResolved: ResolvedInputSource | undefined,
  envSchema: Schema | undefined,
  rawEnv: Dict<string | undefined>,
): Dict<unknown> {
  if (!envSchema) return {}
  if (!envProviderResolved) return rawEnv
  if (isObjectSchema(envSchema)) {
    const out: Dict<unknown> = {}
    for (const key of Object.keys(objectShape(envSchema))) {
      const value = envProviderResolved.get(key)
      if (value !== undefined) out[key] = value
    }
    return out
  }
  // Non-object env schemas (e.g. z.record passthrough) read the full bag.
  // The envProvider is still consulted per key so provenance is uniform.
  const out: Dict<unknown> = {}
  for (const key of Object.keys(rawEnv)) {
    const value = envProviderResolved.get(key)
    if (value !== undefined) out[key] = value
  }
  return out
}

function buildSourceInspector(
  providers: ReadonlyMap<string, ResolvedInputSource>,
  optionSources: ReadonlyMap<string, OptionValueSource>,
): SourceInspector {
  return {
    option(name) {
      return optionSources.get(name) ?? DEFAULT_OPTION_SOURCE
    },
    source(provider, path) {
      return providers.get(provider)?.source(path) ?? MISSING_SOURCE
    },
    value(provider, path) {
      return providers.get(provider)?.get(path)
    },
  }
}

async function resolveProviders(input: ResolveCommandInputOptions): Promise<Map<string, ResolvedInputSource>> {
  const providers = new Map<string, ResolvedInputSource>()
  const seen = new Set<string>()
  for (const provider of [envProvider(), ...input.inputSources]) {
    if (seen.has(provider.id))
      throw new ParseError({ message: `Input source provider registered more than once: ${provider.id}` })
    seen.add(provider.id)
    providers.set(
      provider.id,
      await provider.resolve({
        commandPath: input.commandPath,
        env: input.env,
        flags: input.flags,
      }),
    )
  }
  return providers
}

function envProvider(): InputSourceProvider {
  return {
    id: 'env',
    async resolve({ env }) {
      return {
        get(path) {
          return env[path]
        },
        source(path) {
          return env[path] === undefined ? MISSING_SOURCE : { kind: 'env', name: path }
        },
      }
    },
  }
}

function coerceSourceValue(
  optionName: string,
  provider: string,
  path: string,
  schema: Schema | undefined,
  value: unknown,
): unknown {
  if (typeof value !== 'string') return value
  const kind = primitiveKind(schema)
  if (kind === 'boolean') {
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    throw new ParseError({
      message: `Input source ${provider}:${path} for option ${optionName} is not a boolean (expected true/false/1/0)`,
    })
  }
  if (kind === 'number') {
    const n = Number(value)
    if (Number.isFinite(n) && value.trim() !== '') return n
    throw new ParseError({
      message: `Input source ${provider}:${path} for option ${optionName} is not a finite number`,
    })
  }
  return value
}

import type {
  CommandRuntime,
  Dict,
  InputSourceProvider,
  InputSourceProvenance,
  OptionValueSource,
  ResolvedInputSource,
  Schema,
  SourceInspector,
} from '../types.js'
import { ParseError } from '../errors/error.js'
import { isObjectSchema, objectShape, primitiveKind } from '../schema/zod.js'
import { parseArgsAsync, parseCommandOptions, parseObjectAsync } from '../parser/argv.js'

export type ResolveCommandInputOptions = {
  argvOptions: { args: string[]; argsObject?: Dict | undefined; options?: Dict | undefined }
  commandPath: readonly string[]
  env: Dict<string | undefined>
  flags: Dict
  inputSources: readonly InputSourceProvider[]
  onDeprecation?: ((flag: string, option: string) => void) | undefined
  runtime: CommandRuntime
  rootVarsSchema?: Schema<any> | undefined
}

export type ResolvedCommandInput = {
  args: unknown
  env: unknown
  options: unknown
  sources: SourceInspector
  vars: unknown
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
      rawOptions[optionName] = coerceSourceValue(optionName, binding.provider, binding.path, optionShape[optionName], raw)
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

  const args = input.argvOptions.argsObject !== undefined
    ? await parseObjectAsync(input.runtime.args, input.argvOptions.argsObject)
    : await parseArgsAsync(input.runtime.args, argv.args)
  const env = await parseObjectAsync(input.runtime.env, envBag)
  const options = await parseObjectAsync(input.runtime.options, rawOptions)
  const vars = await parseObjectAsync(input.rootVarsSchema, {})

  return {
    args,
    env,
    options,
    sources: buildSourceInspector(providers, optionSources),
    vars,
  }
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
    if (seen.has(provider.id)) throw new ParseError({ message: `Input source provider registered more than once: ${provider.id}` })
    seen.add(provider.id)
    providers.set(provider.id, await provider.resolve({
      commandPath: input.commandPath,
      env: input.env,
      flags: input.flags,
    }))
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

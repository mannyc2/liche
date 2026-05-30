import { defineCommand, defineExtension, parseSchema, ParseError, ValidationError, z } from '@liche/core'
import type {
  Awaitable,
  CliExtension,
  Dict,
  GlobalInputDefinition,
  InputSourceProvenance,
  InputSourceResolveInput,
  Schema,
} from '@liche/core'
import { fileExists, readConfigFile } from './internal/loader.js'
import { mergeLayer } from './internal/merge.js'
import { discoverCandidates, expandHome, type ScopesDeclaration } from './internal/paths.js'

export type ConfigLayer = { data: Dict; source: InputSourceProvenance }

export type ConfigSource = (input: ConfigSourceInput) => Awaitable<readonly ConfigLayer[]>

export type ConfigSourceInput = InputSourceResolveInput & {
  schema: Schema<unknown> | undefined
}

export type ConfigExtensionOptions<T = Record<string, unknown>> = {
  flag?: string | undefined
  schema?: Schema<T> | undefined
  sources?: readonly ConfigSource[] | undefined
}

export type FilesSourceOptions = {
  files: readonly string[]
  scopes?: ScopesDeclaration | undefined
}

export type EnvSourceOptions = {
  prefix: string
}

export function config<T extends Record<string, unknown> = Record<string, unknown>>(
  options: ConfigExtensionOptions<T> = {},
): CliExtension {
  const flag = options.flag ?? 'config'
  const noFlag = `no-${flag}`
  const sources = options.sources ?? []
  const globals: GlobalInputDefinition[] = [
    {
      description: 'Load config from path',
      expose: 'runtime',
      flag,
      key: 'configPath',
      type: 'string',
      valueLabel: 'path',
    },
    {
      description: 'Disable config discovery',
      expose: 'runtime',
      flag: noFlag,
      key: 'configDisabled',
      type: 'boolean',
    },
  ]

  const provider = {
    id: 'config',
    async resolve(input) {
      const flags = input.flags as { configPath?: string | undefined; configDisabled?: boolean | undefined }
      if (flags.configPath !== undefined && flags.configDisabled) {
        throw new ParseError({ message: `Cannot pass --${flag} and --${noFlag} together` })
      }
      if (flags.configDisabled) {
        const values = parseConfig(options.schema, {})
        return resolvedConfigSource(values, new Map())
      }
      const layers: ConfigLayer[] = []
      if (flags.configPath !== undefined) {
        const path = expandHome(flags.configPath, input.env)
        if (!(await fileExists(path))) {
          throw new ParseError({ message: `Config file not found: ${flags.configPath}` })
        }
        layers.push({ data: await readConfigFile(path), source: { kind: 'explicit-file', path } })
      } else {
        const sourceInput: ConfigSourceInput = { ...input, schema: options.schema }
        for (const source of sources) {
          layers.push(...(await source(sourceInput)))
        }
      }

      const merged: Dict = {}
      const sourceMap = new Map<string, InputSourceProvenance>()
      for (const layer of layers) mergeLayer(merged, sourceMap, layer.data, layer.source)
      const values = parseConfig(options.schema, merged)
      return resolvedConfigSource(values, sourceMap)
    },
  } satisfies NonNullable<CliExtension['inputSources']>[number]

  return defineExtension({
    id: 'liche.config',
    globals,
    inputSources: [provider],
  })
}

function parseConfig(schema: Schema<unknown> | undefined, value: Dict): Dict {
  try {
    return parseSchema(schema, value, value) as Dict
  } catch (error) {
    if (error instanceof ValidationError) {
      const detail = error.fieldErrors?.map((field) => `${field.path}: ${field.message}`).join('; ')
      throw new ParseError({ message: detail ? `Invalid config: ${detail}` : 'Invalid config' })
    }
    throw error
  }
}

function resolvedConfigSource(
  values: Dict,
  sourceMap: ReadonlyMap<string, InputSourceProvenance>,
): Awaited<ReturnType<NonNullable<CliExtension['inputSources']>[number]['resolve']>> {
  return {
    get(path) {
      return path === '' ? values : getPath(values, path)
    },
    source(path) {
      return sourceMap.get(path) ?? { kind: 'default' }
    },
  }
}

function getPath(value: Dict, path: string): unknown {
  if (path === '') return value
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Dict)[segment]
  }
  return current
}

export function files(options: FilesSourceOptions): ConfigSource {
  return async (input) => {
    const candidates = discoverCandidates(options.files, options.scopes, input.env)
    const layers: ConfigLayer[] = []
    for (const candidate of candidates) {
      if (!(await fileExists(candidate.file))) continue
      layers.push({ data: await readConfigFile(candidate.file), source: candidate.source })
    }
    return layers
  }
}

export function env(options: EnvSourceOptions): ConfigSource {
  return (input) => {
    const data: Dict = {}
    const shape = topLevelShape(input.schema)
    if (!shape) return []
    const layer: ConfigLayer = { data, source: { kind: 'env', var: options.prefix } }
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const varName = `${options.prefix}${key.toUpperCase()}`
      const raw = input.env[varName]
      if (raw === undefined) continue
      data[key] = coerceEnvValue(varName, raw, fieldSchema)
    }
    return Object.keys(data).length ? [{ ...layer, source: { kind: 'env', var: options.prefix } }] : []
  }
}

function coerceEnvValue(varName: string, raw: string, schema: Schema<unknown>): unknown {
  const kind = schemaKind(schema)
  if (kind === 'string') return raw
  if (kind === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new ParseError({ message: `Env var ${varName}=${raw} is not a finite number` })
    return n
  }
  if (kind === 'boolean') {
    if (raw === 'true' || raw === '1') return true
    if (raw === 'false' || raw === '0') return false
    throw new ParseError({ message: `Env var ${varName}=${raw} is not a boolean (expected true/false/1/0)` })
  }
  throw new ParseError({
    message: `Env source does not support non-primitive field '${varName}'; use a file source for nested config`,
  })
}

function topLevelShape(schema: Schema<unknown> | undefined): Dict<Schema<unknown>> | undefined {
  if (!schema) return undefined
  const unwrapped = unwrap(schema)
  if (!(unwrapped instanceof z.ZodObject)) return undefined
  return unwrapped.shape
}

const WRAPPER_KINDS = ['optional', 'default', 'nullable', 'catch', 'readonly']

function unwrap(schema: Schema<unknown>): Schema<unknown> {
  let current: any = schema
  while (current && WRAPPER_KINDS.includes(current.type ?? '')) {
    const inner =
      current.def?.innerType ?? (typeof current.unwrap === 'function' ? safeCall(() => current.unwrap()) : undefined)
    if (!inner || inner === current) return current
    current = inner
  }
  return current
}

function schemaKind(schema: Schema<unknown>): string | undefined {
  return (unwrap(schema) as any)?.type
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

export function configDoctor(): CliExtension {
  return defineExtension({
    id: 'liche.config-doctor',
    commands: [
      defineCommand({
        description: 'Inspect config loading',
        path: ['config', 'doctor'],
        run: ({ ctx }) => ({
          config: {
            enabled: true,
            keys: Object.keys((ctx.sources.value('config', '') as Dict | undefined) ?? {}).sort(),
          },
        }),
      }),
    ],
  })
}

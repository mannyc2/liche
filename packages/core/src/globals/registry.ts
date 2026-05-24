import type {
  CreateOptions,
  DisabledGlobal,
  GlobalInputDefinition,
  NormalizedGlobalInputDefinition,
} from '../types.js'
import { normalizeGlobalInput } from './definition.js'

type CoreGlobalInput = GlobalInputDefinition & {
  disabledBy?: DisabledGlobal | undefined
  parse?: ((value: string, flag: string) => boolean | number | string) | undefined
}

export type RuntimeGlobalInput = NormalizedGlobalInputDefinition & {
  disabled?: boolean | undefined
  disabledBy?: DisabledGlobal | undefined
  parse?: ((value: string, flag: string) => boolean | number | string) | undefined
}

const formatValues = ['json', 'yaml', 'md', 'jsonl'] as const

export function globalRegistryFor(definition: CreateOptions): readonly RuntimeGlobalInput[] {
  const disabled = new Set<DisabledGlobal>(definition.generated?.disabledGlobals ?? [])
  return assertUniqueGlobals([
    ...normalizeGlobalInputs(definition.globals ?? []),
    ...configGlobals(definition),
    ...coreGlobals(disabled),
  ])
}

function normalizeGlobalInputs(globals: readonly GlobalInputDefinition[]): RuntimeGlobalInput[] {
  return globals.map((global) => normalizeGlobalInput(global))
}

function configGlobals(definition: CreateOptions): RuntimeGlobalInput[] {
  const enabled = definition.config !== undefined
  const flag = definition.config?.flag ?? 'config'
  const globals: RuntimeGlobalInput[] = [
    {
      ...normalizeGlobalInput({
        description: 'Load config from path',
        expose: 'runtime',
        flag,
        hidden: !enabled,
        key: 'configPath',
        type: 'string',
        valueLabel: 'path',
      }),
    },
    {
      ...normalizeGlobalInput({
        description: 'Disable config discovery',
        expose: 'runtime',
        flag: `no-${flag}`,
        hidden: !enabled,
        key: 'configDisabled',
        type: 'boolean',
      }),
    },
  ]
  if (flag !== 'config') {
    globals.push(
      {
        ...normalizeGlobalInput({
          expose: 'runtime',
          flag: 'config',
          hidden: true,
          key: 'configPath',
          type: 'string',
          valueLabel: 'path',
        }),
      },
      {
        ...normalizeGlobalInput({
          expose: 'runtime',
          flag: 'no-config',
          hidden: true,
          key: 'configDisabled',
          type: 'boolean',
        }),
      },
    )
  }
  return globals
}

function coreGlobals(disabled: ReadonlySet<DisabledGlobal>): RuntimeGlobalInput[] {
  return coreGlobalDefinitions().map((global) => {
    const normalized = normalizeGlobalInput(global)
    const isDisabled = global.disabledBy !== undefined && disabled.has(global.disabledBy)
    return {
      ...normalized,
      ...(global.parse ? { parse: global.parse } : undefined),
      ...(global.disabledBy ? { disabledBy: global.disabledBy } : undefined),
      ...(isDisabled ? { disabled: true, hidden: true } : undefined),
    }
  })
}

function coreGlobalDefinitions(): CoreGlobalInput[] {
  return [
    {
      disabledBy: 'format',
      expose: 'runtime',
      flag: 'format',
      key: 'format',
      parse: parseFormat,
      type: 'string',
      valueLabel: formatValues.join('|'),
    },
    { expose: 'runtime', flag: 'json', key: 'json', type: 'boolean' },
    { expose: 'runtime', flag: 'full-output', key: 'fullOutput', type: 'boolean' },
    { expose: 'runtime', flag: 'filter-output', key: 'filterOutput', type: 'string', valueLabel: 'paths' },
    { expose: 'runtime', flag: 'llms', key: 'llms', type: 'boolean' },
    { expose: 'runtime', flag: 'mcp', key: 'mcp', type: 'boolean' },
    { expose: 'runtime', flag: 'schema', key: 'schema', type: 'boolean' },
    { expose: 'runtime', flag: 'token-count', key: 'tokenCount', type: 'boolean' },
    { expose: 'runtime', flag: 'token-limit', key: 'tokenLimit', parse: parseFiniteNumber, type: 'string', valueLabel: 'n' },
    { expose: 'runtime', flag: 'token-offset', key: 'tokenOffset', parse: parseFiniteNumber, type: 'string', valueLabel: 'n' },
    { alias: 'h', expose: 'runtime', flag: 'help', key: 'help', type: 'boolean' },
    { expose: 'runtime', flag: 'version', key: 'version', type: 'boolean' },
  ]
}

function parseFormat(value: string, _flag: string): string {
  if (!formatValues.includes(value as (typeof formatValues)[number])) {
    throw new Error(`Invalid format: "${value}". Expected one of: ${formatValues.join(', ')}`)
  }
  return value
}

function parseFiniteNumber(value: string, flag: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || value.trim() === '') {
    throw new Error(`Invalid value for --${flag}: "${value}"`)
  }
  return n
}

function assertUniqueGlobals(globals: RuntimeGlobalInput[]): RuntimeGlobalInput[] {
  const flags = new Map<string, RuntimeGlobalInput>()
  const aliases = new Map<string, RuntimeGlobalInput>()
  for (const global of globals) {
    const duplicate = flags.get(global.flag)
    if (duplicate) throw new Error(`Global flag --${global.flag} is declared more than once`)
    if (aliases.has(global.flag)) {
      throw new Error(`Global flag --${global.flag} conflicts with global alias -${global.flag}`)
    }
    flags.set(global.flag, global)

    if (!global.alias) continue
    if (flags.has(global.alias)) {
      throw new Error(`Global alias -${global.alias} conflicts with global flag --${global.alias}`)
    }
    const duplicateAlias = aliases.get(global.alias)
    if (duplicateAlias) throw new Error(`Global alias -${global.alias} is declared more than once`)
    aliases.set(global.alias, global)
  }
  return globals
}

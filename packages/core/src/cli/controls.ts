import type { CliExtension, Format, GlobalInputDefinition, HelpRenderer } from '../types.js'
import { builtInFormatValues } from '../format/index.js'
import { defineExtension } from './create.js'

export type HelpControlOptions = {
  renderer?: HelpRenderer | undefined
}

export type OutputControlsOptions = {
  filterOutput?: boolean | undefined
  format?: boolean | undefined
  formats?: readonly Format[] | undefined
  json?: boolean | undefined
}

export type ReflectionControlsOptions = {
  schema?: boolean | undefined
}

export function help(options: HelpControlOptions = {}): CliExtension {
  return defineExtension({
    id: 'liche.core.help',
    globals: [{ alias: 'h', expose: 'runtime', flag: 'help', key: 'help', type: 'boolean' }],
    ...(options.renderer ? { helpRenderer: options.renderer } : undefined),
  })
}

export function version(): CliExtension {
  return defineExtension({
    id: 'liche.core.version',
    globals: [{ expose: 'runtime', flag: 'version', key: 'version', type: 'boolean' }],
  })
}

export function outputControls(options?: OutputControlsOptions): CliExtension {
  const globals: GlobalInputDefinition[] = []
  if (enabled(options, 'format')) {
    const formatValues = options?.formats ?? builtInFormatValues
    globals.push({
      expose: 'runtime',
      flag: 'format',
      key: 'format',
      parse: parseFormat(formatValues),
      type: 'string',
      valueLabel: formatValues.join('|'),
    })
  }
  if (enabled(options, 'json')) globals.push({ expose: 'runtime', flag: 'json', key: 'json', type: 'boolean' })
  if (enabled(options, 'filterOutput')) {
    globals.push({ expose: 'runtime', flag: 'filter-output', key: 'filterOutput', type: 'string', valueLabel: 'paths' })
  }

  return defineExtension({
    id: 'liche.core.output-controls',
    ...(globals.length ? { globals } : undefined),
  })
}

export function reflectionControls(options?: ReflectionControlsOptions): CliExtension {
  const globals: GlobalInputDefinition[] = []
  if (enabled(options, 'schema')) globals.push({ expose: 'runtime', flag: 'schema', key: 'schema', type: 'boolean' })

  return defineExtension({
    id: 'liche.core.reflection-controls',
    ...(globals.length ? { globals } : undefined),
  })
}

function enabled<T extends Record<string, unknown>>(options: T | undefined, key: keyof T): boolean {
  return options === undefined || options[key] === true
}

function parseFormat(formatValues: readonly Format[]): (value: string, flag: string) => string {
  return (value: string, _flag: string) => {
    if (!formatValues.includes(value)) {
      throw new Error(`Invalid format: "${value}". Expected one of: ${formatValues.join(', ')}`)
    }
    return value
  }
}

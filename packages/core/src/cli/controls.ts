import type { CliExtension, Format, GlobalInputDefinition, HelpRenderer } from '../types.js'
import { builtInFormatValues, renderOutput } from '../format/index.js'
import { renderHelp } from '../help/render.js'
import { selectCommand } from '../command/registry.js'
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

// Internal: built-in help/version are registered automatically by defineCli (first-class,
// default-on) through this same public TerminalHandler contract. Not exported from the package
// root — third parties dogfood the contract directly, they do not call these factories.
export function coreHelp(options: HelpControlOptions = {}): CliExtension {
  return defineExtension({
    id: 'liche.core.help',
    globals: [{ alias: 'h', expose: 'runtime', flag: 'help', key: 'help', type: 'boolean' }],
    terminalHandlers: [
      {
        flagKey: 'help',
        commandAware: true,
        // --help OR no command resolved (the bare-`cli` fallback).
        matches: (flags, selected) => Boolean(flags.help) || !selected,
        event: { type: 'help.rendered', surface: 'help' },
        handle: ({ binaryName, state, flags, io }) =>
          io.out(`${renderHelp(binaryName, state, selectCommand(state, flags.rest), flags.rest)}\n`),
      },
    ],
    ...(options.renderer ? { helpRenderer: options.renderer } : undefined),
  })
}

export function coreVersion(): CliExtension {
  return defineExtension({
    id: 'liche.core.version',
    globals: [{ expose: 'runtime', flag: 'version', key: 'version', type: 'boolean' }],
    terminalHandlers: [
      {
        flagKey: 'version',
        event: { type: 'version.rendered', surface: 'version' },
        handle: ({ state, io }) => io.out(`${state.def.version ?? '0.0.0'}\n`),
      },
    ],
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
  if (!enabled(options, 'schema')) return defineExtension({ id: 'liche.core.reflection-controls' })
  return defineExtension({
    id: 'liche.core.reflection-controls',
    globals: [{ expose: 'runtime', flag: 'schema', key: 'schema', type: 'boolean' }],
    terminalHandlers: [
      {
        flagKey: 'schema',
        commandAware: true,
        event: { type: 'schema.generated', surface: 'schema' },
        handle: ({ selected, state, format, io }) => {
          if (!selected) return
          io.out(`${renderOutput(selected.contract?.schema, format, state.outputRenderers, { stage: 'schema' })}\n`)
        },
      },
    ],
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

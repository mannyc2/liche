import type {
  CliState,
  CommandRuntime,
  Dict,
  Entry,
  HelpCommand,
  HelpField,
  HelpGlobal,
  HelpModel,
  HelpRenderContext,
  InputSourceBinding,
  Schema,
  SelectedCommand,
  Usage,
} from '../types.js'
import { isCommand } from '../command/guards.js'
import { childCommands, commandScope } from '../command/registry.js'
import { description, encodeDefault, isBooleanSchema, isDeprecated, isOptional, objectShape } from '../schema/zod.js'
import { kebab } from '../internal.js'

export function renderHelp(name: string, state: CliState, selected?: SelectedCommand | undefined, rest: string[] = []): string {
  const model = buildHelpModel(name, state, selected, rest)
  const context: HelpRenderContext = { binaryName: name, path: model.path }
  return (state.helpRenderer ?? defaultHelpRenderer)(model, context)
}

export function buildHelpModel(name: string, state: CliState, selected?: SelectedCommand | undefined, rest: string[] = []): HelpModel {
  const scope = commandScope(state, selected?.path ?? rest)
  const commands = childCommands(scope)
  const contract = scope.entry && 'contract' in scope.entry ? scope.entry.contract : undefined
  const runtime = commandRuntime(scope.entry) ?? commandRuntime(scope.root)
  const scopedName = `${name}${scope.path.length ? ` ${scope.path.join(' ')}` : ''}`
  return {
    aliases: scope.aliases,
    args: runtime?.args ? argFields(runtime.args) : [],
    commands: commands.map((command) => ({
      aliases: command.aliases ?? [],
      description: command.description,
      name: command.name,
    })),
    description: scope.description,
    examples: contract?.examples ?? [],
    globals: globalFields(state),
    hint: contract?.hint,
    name: scopedName,
    options: runtime?.options ? optionFields(runtime.options, runtime.alias, runtime.sources?.options) : [],
    path: scope.path,
    usage: contract?.usage?.length
      ? usageLines(scopedName, contract.usage as Usage[], runtime?.args, runtime?.options, runtime?.alias)
      : [],
  }
}

export function defaultHelpRenderer(model: HelpModel, _context: HelpRenderContext): string {
  const commands = model.commands
  const hasCommands = commands.length > 0
  const lines = [
    title(model.name, model.description),
    '',
    `Usage: ${model.name}${hasCommands ? ' <command>' : ''}${model.args.length ? ` ${model.args.map((arg) => arg.usage).join(' ')}` : ''}`,
  ]

  if (commands.length) lines.push('', 'Commands:', ...commandLines(commands))
  if (model.aliases.length) lines.push('', `Aliases: ${model.aliases.join(', ')}`)
  if (model.args.length) lines.push('', 'Arguments:', ...argLines(model.args))
  if (model.options.length) lines.push('', 'Options:', ...optionLines(model.options))
  if (model.usage.length) lines.push('', 'Usage:', ...model.usage.map((usage) => `  ${usage}`))
  if (model.examples.length) lines.push('', 'Examples:', ...exampleLines(model.name, model.examples))
  if (model.hint) lines.push('', model.hint)
  if (model.globals.length) lines.push('', 'Global Options:', ...globalLines(model.globals))

  return lines.join('\n')
}

function title(name: string, descriptionText?: string | undefined): string {
  return descriptionText ? `${name} - ${descriptionText}` : name
}

function commandLines(commands: readonly HelpCommand[]): string[] {
  const width = Math.max(1, ...commands.map((command) => command.name.length))
  return commands.map((command) => {
    const aliases = command.aliases?.length ? ` (${command.aliases.join(', ')})` : ''
    return `  ${command.name.padEnd(width)}  ${command.description ?? ''}${aliases}`
  })
}

function argFields(schema: Schema): HelpField[] {
  return Object.entries(objectShape(schema)).map(([key, item]) => ({
    defaultValue: encodeDefault(item),
    description: description(item),
    label: key,
    name: key,
    required: !isOptional(item),
    usage: isOptional(item) ? `[${key}]` : `<${key}>`,
  }))
}

function optionFields(schema: Schema, aliases: Dict<string> = {}, optionSources: Record<string, readonly InputSourceBinding[]> = {}): HelpField[] {
  return Object.entries(objectShape(schema)).map(([key, item]) => {
    const renderedFlag = flag(key, aliases[key])
    const envName = optionSources[key]?.find((source) => source.provider === 'env')?.path
    return {
      defaultValue: encodeDefault(item),
      deprecated: isDeprecated(item),
      description: description(item),
      ...(envName ? { env: envName } : undefined),
      label: renderedFlag.trim(),
      name: key,
      required: !isOptional(item),
      usage: optionUsageToken(key, item, aliases),
    }
  })
}

function usageLines(
  scopedName: string,
  usages: Usage[],
  argsSchema: Schema | undefined,
  optionsSchema: Schema | undefined,
  aliases: Dict<string> = {},
): string[] {
  return usages.map((usage) => {
    if (typeof usage === 'string') return usage
    const argTokens = usageArgTokens(usage.args, argsSchema)
    const optionTokens = usageOptionTokens(usage.options, optionsSchema, aliases)
    const middle = [scopedName, ...argTokens, ...optionTokens].filter(Boolean).join(' ')
    return `${usage.prefix ?? ''}${middle}${usage.suffix ?? ''}`
  })
}

function usageArgTokens(
  args: string[] | Partial<Record<string, true>> | undefined,
  schema: Schema | undefined,
): string[] {
  if (!args) return []
  const keys = Array.isArray(args) ? args : Object.keys(args).filter((key) => args[key])
  const shape = objectShape(schema)
  return keys.map((key) => (isOptional(shape[key]) ? `[${key}]` : `<${key}>`))
}

function usageOptionTokens(
  options: string[] | Partial<Record<string, true>> | undefined,
  schema: Schema | undefined,
  aliases: Dict<string> = {},
): string[] {
  if (!options) return []
  const keys = Array.isArray(options) ? options : Object.keys(options).filter((key) => options[key])
  const shape = objectShape(schema)
  return keys.flatMap((key) => {
    const item = shape[key]
    return [optionUsageToken(key, item, aliases)]
  })
}

function exampleLines(scopedName: string, examples: readonly any[]): string[] {
  return examples.map((example) => {
    if (typeof example === 'string') return `  ${example}`
    const command = [scopedName, example.command].filter(Boolean).join(' ')
    const args = Object.values(example.args ?? {}).map(String)
    const options = Object.entries(example.options ?? {}).flatMap(([key, value]) =>
      value === true ? [`--${kebab(key)}`] : [`--${kebab(key)}`, String(value)],
    )
    const rendered = [command, ...args, ...options].filter(Boolean).join(' ')
    return example.description ? `  ${rendered} - ${example.description}` : `  ${rendered}`
  })
}

function argLines(args: readonly HelpField[]): string[] {
  return args.map((arg) => `  ${arg.name.padEnd(22)}  ${arg.description ?? ''}${arg.defaultValue === undefined ? '' : ` (default: ${arg.defaultValue})`}`)
}

function optionLines(options: readonly HelpField[]): string[] {
  return options.map((option) => {
    const envSuffix = option.env ? ` (env: ${option.env})` : ''
    const deprecatedSuffix = option.deprecated ? ' [deprecated]' : ''
    return `  ${option.label.padEnd(22)}  ${option.description ?? ''}${option.defaultValue === undefined ? '' : ` (default: ${option.defaultValue})`}${envSuffix}${deprecatedSuffix}`
  })
}

function flag(key: string, alias?: string | undefined): string {
  const long = key.length === 1 ? `-${key}` : `--${kebab(key)}`
  return `${alias ? `-${alias}, ` : ''}${long}`.padEnd(22)
}

function optionUsageToken(key: string, schema: Schema | undefined, aliases: Dict<string> = {}): string {
  const long = key.length === 1 ? `-${key}` : `--${kebab(key)}`
  const alias = aliases[key] ? `-${aliases[key]}|` : ''
  const valueToken = isBooleanSchema(schema) ? '' : ` <${key}>`
  return `${alias}${long}${valueToken}`
}

function globalFields(state: CliState): HelpGlobal[] {
  const globals = state.globals.filter((global) => !global.hidden)
  return globals.map((global) => ({
    ...(global.alias ? { alias: global.alias } : undefined),
    ...(global.default !== undefined ? { defaultValue: String(global.default) } : undefined),
    deprecated: global.deprecated,
    description: global.description,
    flag: global.flag,
    key: global.key,
    label: globalFlag(global.flag, global.alias, global.valueLabel),
  }))
}

function globalLines(globals: readonly HelpGlobal[]): string[] {
  return globals.map((global) => {
    const deprecatedSuffix = global.deprecated
      ? ` ${typeof global.deprecated === 'string' ? `[deprecated: ${global.deprecated}]` : '[deprecated]'}`
      : ''
    const defaultSuffix = global.defaultValue === undefined ? '' : ` (default: ${global.defaultValue})`
    const descriptionText = `${global.description ?? ''}${defaultSuffix}${deprecatedSuffix}`
    return descriptionText ? `  ${global.label.padEnd(32)}  ${descriptionText}` : `  ${global.label}`
  })
}

function globalFlag(flagName: string, alias?: string | undefined, valueLabel?: string | undefined): string {
  const long = `--${flagName}${valueLabel ? ` <${valueLabel}>` : ''}`
  return alias ? `${long}, -${alias}` : long
}

function commandRuntime(entry: Entry | undefined): CommandRuntime | undefined {
  return isCommand(entry) ? entry.runtime : undefined
}

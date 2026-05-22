import type { CliState, CommandContract, CommandRuntime, Dict, Entry, Schema, SelectedCommand, Usage } from '../types.js'
import { isCommand } from '../command/guards.js'
import { childCommands, commandScope } from '../command/registry.js'
import { description, encodeDefault, isBooleanSchema, isDeprecated, isOptional, objectShape } from '../schema/zod.js'
import { kebab } from '../internal.js'
import { builtinHelpLines } from '../cli/builtin-metadata.js'

export function renderHelp(name: string, state: CliState, selected?: SelectedCommand | undefined, rest: string[] = []): string {
  const scope = commandScope(state, selected?.path ?? rest)
  const commands = childCommands(scope)
  const contract = scope.entry && 'contract' in scope.entry ? scope.entry.contract : undefined
  const runtime = commandRuntime(scope.entry) ?? commandRuntime(scope.root)
  const scopedName = `${name}${scope.path.length ? ` ${scope.path.join(' ')}` : ''}`
  const hasCommands = commands.length > 0
  const lines = [
    title(scopedName, scope.description),
    '',
    `Usage: ${scopedName}${hasCommands ? ' <command>' : ''}${runtime?.args ? ` ${argUsage(runtime.args)}` : ''}`,
  ]

  if (commands.length) lines.push('', 'Commands:', ...commandLines(commands))
  if (scope.aliases.length) lines.push('', `Aliases: ${scope.aliases.join(', ')}`)
  if (runtime?.args) lines.push('', 'Arguments:', ...argLines(runtime.args))
  if (runtime?.options) lines.push('', 'Options:', ...schemaLines(runtime.options, runtime.alias, runtime.optionEnv))
  if (contract?.usage?.length) lines.push('', 'Usage:', ...usageLines(scopedName, contract.usage as Usage[], runtime?.args, runtime?.options, runtime?.alias))
  if (contract?.examples?.length) lines.push('', 'Examples:', ...exampleLines(scopedName, contract.examples))
  if (contract?.hint) lines.push('', contract.hint)

  const builtins = builtinHelpLines(state.def.builtins, !!state.def.config)
  if (builtins.length) lines.push('', 'Built-in Commands:', ...builtins)

  lines.push(
    '',
    'Global Options:',
    '  --format <json|yaml|md|jsonl>',
    '  --json',
    '  --full-output',
    '  --filter-output <paths>',
    '  --llms',
    '  --mcp',
    '  --schema',
    '  --token-count',
    '  --token-limit <n>',
    '  --token-offset <n>',
    '  --help, -h',
    '  --version',
  )

  return lines.join('\n')
}

function title(name: string, descriptionText?: string | undefined): string {
  return descriptionText ? `${name} - ${descriptionText}` : name
}

function commandLines(commands: CommandContract[]): string[] {
  const width = Math.max(1, ...commands.map((command) => command.name.length))
  return commands.map((command) => {
    const aliases = command.aliases?.length ? ` (${command.aliases.join(', ')})` : ''
    return `  ${command.name.padEnd(width)}  ${command.description ?? ''}${aliases}`
  })
}

function argUsage(schema: Schema): string {
  return Object.entries(objectShape(schema))
    .map(([key, item]) => (isOptional(item) ? `[${key}]` : `<${key}>`))
    .join(' ')
}

function schemaLines(schema: Schema, aliases: Dict<string> = {}, optionEnv: Dict<string> = {}): string[] {
  return Object.entries(objectShape(schema)).map(([key, item]) => {
    const renderedFlag = flag(key, aliases[key])
    const envName = optionEnv[key]
    const envSuffix = envName ? ` (env: ${envName})` : ''
    const deprecatedSuffix = isDeprecated(item) ? ' [deprecated]' : ''
    return `  ${renderedFlag}  ${description(item) ?? ''}${defaultSuffix(item)}${envSuffix}${deprecatedSuffix}`
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
    if (typeof usage === 'string') return `  ${usage}`
    const argTokens = usageArgTokens(usage.args, argsSchema)
    const optionTokens = usageOptionTokens(usage.options, optionsSchema, aliases)
    const middle = [scopedName, ...argTokens, ...optionTokens].filter(Boolean).join(' ')
    return `  ${usage.prefix ?? ''}${middle}${usage.suffix ?? ''}`
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
    const long = key.length === 1 ? `-${key}` : `--${kebab(key)}`
    const alias = aliases[key] ? `-${aliases[key]}|` : ''
    const item = shape[key]
    const valueToken = isBooleanSchema(item) ? '' : ` <${key}>`
    return [`${alias}${long}${valueToken}`]
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

function argLines(schema: Schema): string[] {
  return Object.entries(objectShape(schema)).map(([key, item]) => `  ${key.padEnd(22)}  ${description(item) ?? ''}${defaultSuffix(item)}`)
}

function defaultSuffix(schema: Schema): string {
  const encoded = encodeDefault(schema)
  return encoded === undefined ? '' : ` (default: ${encoded})`
}

function flag(key: string, alias?: string | undefined): string {
  const long = key.length === 1 ? `-${key}` : `--${kebab(key)}`
  return `${alias ? `-${alias}, ` : ''}${long}`.padEnd(22)
}

function commandRuntime(entry: Entry | undefined): CommandRuntime | undefined {
  return isCommand(entry) ? entry.runtime : undefined
}

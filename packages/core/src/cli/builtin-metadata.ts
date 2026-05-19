import type { BuiltinsConfig } from '../types.js'

export type BuiltinCommand = {
  description: string
  name: string
  subcommands?: BuiltinCommand[] | undefined
}

export type BuiltinName = keyof BuiltinsConfig

export const builtinCommands: readonly BuiltinCommand[] = [
  { description: 'Generate shell completion script', name: 'completions' },
  { description: 'Generate typed Cli.Commands declarations', name: 'gen' },
  { description: 'MCP server config', name: 'mcp', subcommands: [{ description: 'Register MCP server config', name: 'add' }] },
  {
    description: 'Skill file management',
    name: 'skills',
    subcommands: [
      { description: 'Sync skill file', name: 'add' },
      { description: 'List available skills', name: 'list' },
    ],
  },
]

export function enabledBuiltins(config: BuiltinsConfig | undefined): BuiltinsConfig {
  return {
    completions: config?.completions ?? true,
    gen: config?.gen ?? false,
    mcp: config?.mcp ?? false,
    skills: config?.skills ?? false,
  }
}

export function builtinEnabled(name: string, config: BuiltinsConfig | undefined): boolean {
  return enabledBuiltins(config)[name as BuiltinName] === true
}

export function builtinSuggestions(words: string[], config?: BuiltinsConfig | undefined): string[] {
  const enabled = enabledBuiltins(config)
  const current = words.at(-1) ?? ''
  const completed = words.slice(0, -1)
  const commands = enabledCommands(enabled)
  const parent = completed.length === 1 ? commands.find((command) => command.name === completed[0]) : undefined
  const candidates = parent?.subcommands ?? (completed.length ? [] : commands)

  return candidates.map((command) => command.name).filter((name) => name.startsWith(current))
}

export function builtinHelpLines(config?: BuiltinsConfig | undefined): string[] {
  return flattenBuiltins(enabledCommands(enabledBuiltins(config))).map(({ description, name }) => `  ${name.padEnd(12)} ${description}`)
}

function enabledCommands(config: BuiltinsConfig): BuiltinCommand[] {
  return builtinCommands.filter((command) => config[command.name as BuiltinName] === true)
}

function flattenBuiltins(commands: readonly BuiltinCommand[]): BuiltinCommand[] {
  return commands.flatMap((command) =>
    command.subcommands?.length
      ? command.subcommands.map((subcommand) => ({
          description: subcommand.description,
          name: `${command.name} ${subcommand.name}`,
        }))
      : [command],
  )
}

export type BuiltinCommand = {
  description: string
  name: string
  subcommands?: BuiltinCommand[] | undefined
}

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

export function builtinSuggestions(words: string[]): string[] {
  const current = words.at(-1) ?? ''
  const completed = words.slice(0, -1)
  const parent = completed.length === 1 ? builtinCommands.find((command) => command.name === completed[0]) : undefined
  const commands = parent?.subcommands ?? (completed.length ? [] : builtinCommands)

  return commands.map((command) => command.name).filter((name) => name.startsWith(current))
}

export function builtinHelpLines(): string[] {
  return flattenBuiltins().map(({ description, name }) => `  ${name.padEnd(12)} ${description}`)
}

function flattenBuiltins(): BuiltinCommand[] {
  return builtinCommands.flatMap((command) =>
    command.subcommands?.length
      ? command.subcommands.map((subcommand) => ({
          description: subcommand.description,
          name: `${command.name} ${subcommand.name}`,
        }))
      : [command],
  )
}

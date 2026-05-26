import type { CliState, CommandContract } from '@liche/core'
import { collectCommandContracts, manifest } from '@liche/core'

export function skillMarkdown(name: string, state: CliState): string {
  if (state.def.skill?.markdown) return state.def.skill.markdown

  const data = manifest(name, state)
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${data.description ?? `${name} CLI`}`,
    '---',
    '',
    `# ${name}`,
    '',
    data.description ?? '',
    '',
    '## Commands',
  ]

  for (const command of skillCommandContracts(state)) {
    lines.push('', `### ${command.name}`, command.description ?? '', '', code(name, command.name))
    const schema = command.schema as any
    const optionsSchema = schema?.options
    const deprecated = new Set<string>((schema?.deprecated as string[] | undefined) ?? [])
    if (optionsSchema?.properties) {
      lines.push('', '**Options**', '')
      lines.push('| Flag | Description |')
      lines.push('| --- | --- |')
      for (const [key, prop] of Object.entries(optionsSchema.properties as Record<string, any>)) {
        const dep = deprecated.has(key) ? ' **Deprecated.**' : ''
        lines.push(`| --${kebab(key)} | ${prop.description ?? ''}${dep} |`)
      }
    }
    if (command.hint) lines.push('', `> ${command.hint}`)
    if (command.examples?.length) lines.push('', '**Examples**', '', ...renderExamples(name, command))
  }

  return lines.join('\n')
}

export function skillIndex(name: string, state: CliState): string {
  if (state.def.skill?.index) return state.def.skill.index

  const commands = skillCommandContracts(state)
  return [`# ${name}`, state.def.description ?? '', '', ...commands.map((command) => `- ${command.name}: ${command.description ?? ''}`)].join('\n')
}

function skillCommandContracts(state: CliState): CommandContract[] {
  return collectCommandContracts(state.commands, state.root).filter((command) => !command.interactive)
}

function renderExamples(name: string, command: CommandContract): string[] {
  return (command.examples ?? []).map((example: any) => {
    if (typeof example === 'string') return `- \`${example}\``
    const args = Object.values(example.args ?? {}).map(String)
    const options = Object.entries(example.options ?? {}).flatMap(([key, value]) =>
      value === true ? [`--${kebab(key)}`] : [`--${kebab(key)}`, String(value)],
    )
    const cmd = [name, command.name === '(root)' ? '' : command.name, ...args, ...options].filter(Boolean).join(' ')
    return example.description ? `- \`${cmd}\` — ${example.description}` : `- \`${cmd}\``
  })
}

function kebab(input: string): string {
  return input.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

function code(name: string, commandName: string): string {
  const suffix = commandName === '(root)' ? '' : ` ${commandName}`
  return `\`$ ${name}${suffix}\``
}

import { defineCommand, defineExtension, z } from '@liche/core'
import type { CliExtension } from '@liche/core'

export type CompletionsOptions = {
  commandName?: string | undefined
}

const shells = ['bash', 'zsh', 'fish'] as const
const completionArgs = z.object({
  shell: z.enum(shells).default('bash'),
})

export function completions(options: CompletionsOptions = {}): CliExtension {
  return defineExtension({
    id: 'liche.completions',
    commands: [
      defineCommand({
        description: 'Generate shell completion script',
        format: 'md',
        input: { args: completionArgs },
        output: z.string(),
        path: ['completions'],
        run: ({ ctx, input }) => completionScript(input.args.shell, options.commandName ?? ctx.name),
        safety: { readOnly: true },
      }),
    ],
  })
}

export function completionScript(shell: string, binaryName: string): string {
  const command = shellWord(binaryName)
  const functionName = completionFunctionName(binaryName)
  if (shell === 'fish') {
    return [
      `function ${functionName}`,
      `    env COMPLETE=fish ${command} -- (commandline -opc)[2..-1]`,
      'end',
      `complete -c ${command} -f -a "(${functionName})"`,
    ].join('\n')
  }
  if (shell === 'zsh') {
    return [
      `#compdef ${binaryName}`,
      `${functionName}() {`,
      '  local -a completions',
      `  completions=("\${(@f)$(COMPLETE=zsh ${command} -- "\${words[@]:1}")}")`,
      '  compadd -- "${completions[@]}"',
      '}',
      `compdef ${functionName} ${command}`,
    ].join('\n')
  }
  return [
    `${functionName}(){`,
    "  local IFS=$'\\n'",
    `  COMPREPLY=( $(COMPLETE=bash ${command} -- "\${COMP_WORDS[@]:1}") )`,
    '}',
    `complete -F ${functionName} -- ${command}`,
  ].join('\n')
}

function completionFunctionName(binaryName: string): string {
  const safeName = binaryName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'cli'
  return `_${/^[A-Za-z_]/.test(safeName) ? safeName : `_${safeName}`}_complete`
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

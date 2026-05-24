import type { CliState } from '../types.js'
import { completionCommands } from '../command/registry.js'

export const shells = ['bash', 'zsh', 'fish'] as const
export type Shell = typeof shells[number]

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

export function complete(state: CliState, words: string[], index: number): string[] {
  const cleanWords = words.filter((word) => word !== '--')
  const scopedWords = cleanWords.slice(0, Math.max(index + 1, 1))

  return completionCommands(state, scopedWords)
    .filter((name): name is string => Boolean(name))
    .filter((name, offset, all) => all.indexOf(name) === offset)
}

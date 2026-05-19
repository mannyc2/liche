import type { CliState } from '../types.js'
import { completionCommands } from '../command/registry.js'
import { builtinSuggestions } from '../cli/builtin-metadata.js'

export type Shell = 'bash' | 'zsh' | 'fish'
export const shells: readonly Shell[] = ['bash', 'zsh', 'fish']

export function completionScript(shell: string, binaryName: string): string {
  if (shell === 'fish') return `complete -c ${binaryName} -f -a \"$(COMPLETE=fish ${binaryName})\"`
  return `_${binaryName}_complete(){ COMPREPLY=( $(COMPLETE=${shell} ${binaryName} -- \"\${COMP_WORDS[@]:1}\") ); }; complete -F _${binaryName}_complete ${binaryName}`
}

export function complete(state: CliState, words: string[], index: number): string[] {
  const cleanWords = words.filter((word) => word !== '--')
  const scopedWords = cleanWords.slice(0, Math.max(index + 1, 1))

  return completionCommands(state, scopedWords)
    .concat(builtinSuggestions(scopedWords, state.def.builtins))
    .filter((name): name is string => Boolean(name))
    .filter((name, offset, all) => all.indexOf(name) === offset)
}

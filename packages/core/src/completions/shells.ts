import type { CliState } from '../types.js'
import { completionCommands } from '../command/registry.js'

export const shells = ['bash', 'zsh', 'fish'] as const
export type Shell = (typeof shells)[number]

export function complete(state: CliState, words: string[], index: number): string[] {
  const cleanWords = words.filter((word) => word !== '--')
  const scopedWords = cleanWords.slice(0, Math.max(index + 1, 1))

  return completionCommands(state, scopedWords)
    .filter((name): name is string => Boolean(name))
    .filter((name, offset, all) => all.indexOf(name) === offset)
}

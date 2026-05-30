import type { CliState, GlobalFlags, SelectedCommand, TerminalCommandInfo } from '../types.js'
import { commandContract } from '../command/contract.js'

// Helpers for the unified terminal-flag mechanism. Built-in flags (--version/--help/--schema)
// are registered like any extension (see cli/controls.ts) — there is no privileged built-in
// list here. The terminal runner iterates state.terminalHandlers directly (split by
// commandAware); these helpers cover the two cross-cutting needs.

/**
 * The terminal-only flag the invocation set, if any — used by the result-returning lanes
 * (dispatch/parseInvocation) to reject run-only flags by PRESENCE, generically, with no
 * hardcoded flag names. (The help no-command fallback is a runner concern, not a flag.)
 */
export function matchedTerminalFlag(flags: GlobalFlags, state: CliState): string | undefined {
  return state.terminalHandlers.find((handler) => Boolean(flags[handler.flagKey]))?.flagKey
}

/**
 * Project the internal SelectedCommand to the public {@link TerminalCommandInfo} a handler
 * receives — never exposing the internal entry. Defined whenever a command was selected, so
 * a handler's `!selected` check means "no command resolved", independent of contract presence.
 */
export function toCommandInfo(selected: SelectedCommand | undefined): TerminalCommandInfo | undefined {
  if (!selected) return undefined
  return { path: selected.path, contract: commandContract(selected.path.join(' ') || '(root)', selected.entry) }
}

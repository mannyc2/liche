import type { CliState, Dict, Format, PrepareContextHook, RunContext, SelectedCommand } from '../types.js'
import { isRuntimeResult, ParseError } from '../errors/error.js'
import { commandFormat } from '../command/registry.js'

export const DEFAULT_FORMAT: Format = 'json'

export function defaultEnv(): Dict<string | undefined> {
  return Bun.env
}

export type ResolveFormatInput = {
  explicit?: Format | undefined
  flags?: { json?: boolean | undefined; format?: Format | undefined; formatExplicit?: boolean | undefined } | undefined
  selected?: SelectedCommand | undefined
  cliDefault?: Format | undefined
}

export type ResolvedFormat = {
  format: Format
  formatExplicit: boolean
}

export function resolveFormat(input: ResolveFormatInput): ResolvedFormat {
  const flags = input.flags ?? {}
  const format =
    input.explicit ??
    (flags.json ? 'json' : flags.format) ??
    (input.selected ? commandFormat(input.selected) : undefined) ??
    input.cliDefault ??
    DEFAULT_FORMAT
  const formatExplicit = input.explicit !== undefined || !!(flags.formatExplicit || flags.json)
  return { format, formatExplicit }
}

export async function runPrepareContext(
  hooks: readonly PrepareContextHook[],
  input: { name: string; env: Dict<string | undefined>; flags: Dict },
): Promise<Partial<RunContext>> {
  const overrides: Partial<RunContext> = {}
  for (const hook of hooks) {
    const result = await hook(input)
    if (!result) continue
    if (isRuntimeResult(result)) {
      if (!result.ok) throw new ParseError({ message: result.error.message ?? 'Prepare context failed' })
      continue
    }
    if (result.patch) Object.assign(overrides, result.patch)
  }
  return overrides
}

export function contextGlobals(
  flags: Record<string, unknown>,
  state: CliState,
): Record<string, boolean | string | undefined> {
  const out: Record<string, boolean | string | undefined> = {}
  for (const global of state.globals) {
    if (global.expose !== 'context') continue
    const value = flags[global.key]
    if (typeof value === 'boolean' || typeof value === 'string') out[global.key] = value
  }
  return out
}

export function isFlagLikeToken(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

import type { SourceInspector } from '@liche/core'
import type { InvocationKind } from './types.js'

/**
 * Detects invocation surface from env (via the source inspector):
 *
 * - `LICHE_INVOCATION=mcp|agent|cli|ci` is honored if a wrapping lane (e.g.
 *   the MCP server) declares it.
 * - Otherwise: standard CI env vars (CI, GITHUB_ACTIONS, etc.) → `'ci'`.
 * - Otherwise: `'cli'`.
 *
 * 'agent' / 'mcp' are not derivable from env alone; wrapping lanes set
 * `LICHE_INVOCATION` when calling into command execution.
 */
export function detectInvocation(ctx: { sources: SourceInspector }): InvocationKind {
  const declared = ctx.sources.value('env', 'LICHE_INVOCATION')
  if (declared === 'cli' || declared === 'ci' || declared === 'agent' || declared === 'mcp') return declared
  return isCiEnv(ctx.sources) ? 'ci' : 'cli'
}

function isCiEnv(sources: SourceInspector): boolean {
  const truthy = (v: unknown): boolean =>
    typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
  if (truthy(sources.value('env', 'CI'))) return true
  return ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'TF_BUILD'].some(
    (key) => truthy(sources.value('env', key)),
  )
}

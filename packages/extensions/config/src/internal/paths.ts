import type { InputSourceProvenance } from '@liche/core'

export type ConfigCandidate = { file: string; source: InputSourceProvenance }

export type ScopeDeclaration =
  | boolean
  | {
      discoverUpwards?: boolean | undefined
      xdg?: boolean | undefined
    }

export type ScopesDeclaration = {
  project?: ScopeDeclaration | undefined
  user?: ScopeDeclaration | undefined
}

export function expandHome(path: string, env: Record<string, string | undefined>): string {
  if (!path.startsWith('~/')) return path
  const home = env['HOME'] ?? env['USERPROFILE'] ?? '.'
  return `${home}${path.slice(1)}`
}

export function discoverCandidates(
  files: readonly string[],
  scopes: ScopesDeclaration | undefined,
  env: Record<string, string | undefined>,
): ConfigCandidate[] {
  const out: ConfigCandidate[] = []
  const projectEnabled = scopes?.project !== false
  if (projectEnabled) {
    const discoverUpwards =
      scopes?.project === true ||
      (typeof scopes?.project === 'object' && scopes.project !== null && scopes.project.discoverUpwards === true)
    // Merge order is lowest-to-highest precedence. Parent project configs load
    // before nearer configs so the cwd-local file wins overlapping keys.
    const dirs = discoverUpwards ? ancestorDirs(process.cwd()).reverse() : [process.cwd()]
    for (const dir of dirs) {
      for (const file of files) {
        const path = absoluteOrJoin(file, dir, env)
        out.push({ file: path, source: { kind: 'project-file', path } })
      }
    }
  }

  const userEnabled =
    scopes?.user === true ||
    (typeof scopes?.user === 'object' && scopes.user !== null && scopes.user.xdg === true)
  if (userEnabled) {
    const root = userConfigRoot(env)
    for (const file of files) {
      const path = absoluteOrJoin(file, root, env)
      out.push({ file: path, source: { kind: 'user-file', path } })
    }
  }

  // Lowest precedence should be first in the merge order.
  return out.sort((a, b) => sourceRank(a.source) - sourceRank(b.source))
}

function sourceRank(source: InputSourceProvenance): number {
  if (source.kind === 'user-file') return 0
  if (source.kind === 'project-file') return 1
  if (source.kind === 'explicit-file') return 2
  return 3
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = []
  let current = start
  while (true) {
    dirs.push(current)
    const next = current.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'
    if (next === current) break
    current = next
  }
  return dirs
}

function userConfigRoot(env: Record<string, string | undefined>): string {
  if (env['XDG_CONFIG_HOME']) return env['XDG_CONFIG_HOME']
  if (env['APPDATA']) return env['APPDATA']
  const home = env['HOME'] ?? env['USERPROFILE'] ?? '.'
  return process.platform === 'darwin' ? `${home}/Library/Application Support` : `${home}/.config`
}

function absoluteOrJoin(file: string, dir: string, env: Record<string, string | undefined>): string {
  const expanded = expandHome(file, env)
  return expanded.startsWith('/') ? expanded : `${dir.replace(/\/$/, '')}/${expanded}`
}

import { parse as yamlParse } from 'yaml'
import type { CliState, ConfigValueSource, Dict } from '../types.js'
import type { GlobalFlags } from './globals.js'
import { ParseError } from '../errors/error.js'
import { isObject } from '../internal.js'
import { parseSchema } from '../schema/zod.js'

export type LoadedConfig = {
  raw: Dict
  values: Dict
  sources: Map<string, ConfigValueSource>
}

export async function loadConfig(
  name: string,
  state: CliState,
  flags: GlobalFlags,
  env?: Record<string, string | undefined>,
): Promise<Dict | undefined> {
  return (await loadConfigResolution(name, state, flags, env))?.raw
}

export async function loadConfigResolution(
  name: string,
  state: CliState,
  flags: GlobalFlags,
  env: Record<string, string | undefined> = Bun.env,
): Promise<LoadedConfig | undefined> {
  const config = state.def.config
  if ((flags.configPath !== undefined || flags.configDisabled) && !config) {
    throw new ParseError({ message: `${flags.configPath !== undefined ? '--config' : '--no-config'} has no effect: cli has no config schema` })
  }
  if (flags.configPath !== undefined && flags.configDisabled) {
    throw new ParseError({ message: '--config and --no-config cannot be used together' })
  }
  if (!config || flags.configDisabled) return undefined

  const explicit = flags.configPath !== undefined
  const files = explicit ? [flags.configPath!] : config.files ?? [`${name}.json`]
  const candidates = explicit
    ? files.map((file) => ({ file: expandHome(file, env), source: { kind: 'explicit-file', path: expandHome(file, env) } as ConfigValueSource }))
    : discoverCandidates(files, config.scopes, env)
  const loadedLayers: Array<{ data: Dict; source: ConfigValueSource }> = []
  for (const candidate of candidates) {
    if (!(await fileExists(candidate.file))) continue
    loadedLayers.push({ data: await readConfigFile(candidate.file), source: candidate.source })
    if (explicit) break
  }
  if (explicit) {
    if (loadedLayers.length === 0) throw new ParseError({ message: `Config file not found: ${flags.configPath}` })
  } else if (loadedLayers.length === 0) {
    const raw = {}
    return finalizeConfig(raw, new Map(), config.schema)
  }

  const raw: Dict = {}
  const sources = new Map<string, ConfigValueSource>()
  for (const layer of loadedLayers) mergeLayer(raw, sources, layer.data, layer.source)
  return finalizeConfig(raw, sources, config.schema)
}

function finalizeConfig(raw: Dict, sources: Map<string, ConfigValueSource>, schema: unknown): LoadedConfig {
  const values = parseSchema(schema as any, raw, raw) as Dict
  return { raw, values, sources }
}

async function readConfigFile(path: string): Promise<Dict> {
  if (/\.jsonc$/i.test(path)) return parseJsonc(await Bun.file(path).text())
  if (/\.ya?ml$/i.test(path)) return yamlParse(await Bun.file(path).text()) ?? {}
  if (/\.toml$/i.test(path)) return (Bun.TOML.parse(await Bun.file(path).text()) ?? {}) as Dict
  return (await Bun.file(path).json()) as Dict
}

function expandHome(path: string, env: Record<string, string | undefined>): string {
  if (!path.startsWith('~/')) return path
  const home = env['HOME'] ?? env['USERPROFILE'] ?? '.'
  return `${home}${path.slice(1)}`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists()
  } catch {
    return false
  }
}

function discoverCandidates(
  files: readonly string[],
  scopes: { project?: unknown; user?: unknown } | undefined,
  env: Record<string, string | undefined>,
): Array<{ file: string; source: ConfigValueSource }> {
  const out: Array<{ file: string; source: ConfigValueSource }> = []
  const projectEnabled = scopes?.project !== false
  if (projectEnabled) {
    const discoverUpwards =
      scopes?.project === true ||
      (typeof scopes?.project === 'object' && scopes.project !== null && (scopes.project as any).discoverUpwards === true)
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
    (typeof scopes?.user === 'object' && scopes.user !== null && (scopes.user as any).xdg === true)
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

function sourceRank(source: ConfigValueSource): number {
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

function mergeLayer(
  target: Dict,
  sources: Map<string, ConfigValueSource>,
  layer: Dict,
  source: ConfigValueSource,
  prefix = '',
): void {
  for (const [key, value] of Object.entries(layer)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isObject(value) && isObject(target[key])) {
      mergeLayer(target[key] as Dict, sources, value as Dict, source, path)
      continue
    }
    target[key] = value
    markSources(sources, value, source, path)
  }
}

function markSources(
  sources: Map<string, ConfigValueSource>,
  value: unknown,
  source: ConfigValueSource,
  prefix = '',
): void {
  if (prefix) sources.set(prefix, source)
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    markSources(sources, nested, source, path)
  }
}

function parseJsonc(input: string): Dict {
  return JSON.parse(stripJsonc(input)) as Dict
}

function stripJsonc(input: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    const next = input[i + 1]
    if (inString) {
      const wasEscaped = escaped
      out += ch
      if (wasEscaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i++
      continue
    }
    out += ch
  }
  return out
}

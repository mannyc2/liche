import { parse as yamlParse } from 'yaml'
import type { CliState, ConfigValueSource, Dict } from '../types.js'
import { ParseError } from '../errors/error.js'
import { parseSchema } from '../schema/zod.js'
import type { GlobalFlags } from './globals.js'
import { parseJsonc } from './jsonc.js'
import { mergeLayer } from './merge.js'
import { discoverCandidates, expandHome } from './paths.js'

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

async function fileExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists()
  } catch {
    return false
  }
}

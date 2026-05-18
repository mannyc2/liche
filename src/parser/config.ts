import { parse as yamlParse } from 'yaml'
import type { CliState, Dict } from '../types.js'
import type { GlobalFlags } from './globals.js'
import { ParseError } from '../errors/error.js'
import { isObject } from '../internal.js'

export async function loadConfig(name: string, state: CliState, flags: GlobalFlags): Promise<Dict | undefined> {
  const config = state.def.config
  if (flags.configPath !== undefined && !config) {
    throw new ParseError({ message: '--config has no effect: cli has no config schema' })
  }
  if (!config || flags.configDisabled) return undefined

  const explicit = flags.configPath !== undefined
  const files = explicit ? [flags.configPath!] : config.files ?? [`${name}.json`]
  for (const file of files.map(expandHome)) {
    if (!(await fileExists(file))) continue
    const loaded = config.loader ? await config.loader(file) : await readConfigFile(file)
    return validateLoaderResult(loaded)
  }

  if (explicit) {
    throw new ParseError({ message: `Config file not found: ${flags.configPath}` })
  }

  if (config.loader) return validateLoaderResult(await config.loader(undefined))
  return undefined
}

function validateLoaderResult(result: unknown): Dict | undefined {
  if (result === undefined) return undefined
  if (!isObject(result)) {
    throw new ParseError({ message: 'Config loader must return a plain object or undefined' })
  }
  return result as Dict
}

export function commandConfig(config: unknown, path: string[]): Dict {
  let cursor: any = config
  for (const segment of path) cursor = cursor?.commands?.[segment]
  return cursor && typeof cursor === 'object' ? cursor : {}
}

async function readConfigFile(path: string): Promise<Dict> {
  if (/\.ya?ml$/i.test(path)) return yamlParse(await Bun.file(path).text()) ?? {}
  return (await Bun.file(path).json()) as Dict
}

function expandHome(path: string): string {
  if (!path.startsWith('~/')) return path
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.'
  return `${home}${path.slice(1)}`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists()
  } catch {
    return false
  }
}

import type { Dict } from '@liche/core'
import { parseJsonc } from './jsonc.js'

export async function readConfigFile(path: string): Promise<Dict> {
  if (/\.jsonc$/i.test(path)) return parseJsonc(await Bun.file(path).text())
  if (/\.ya?ml$/i.test(path)) return (Bun.YAML.parse(await Bun.file(path).text()) ?? {}) as Dict
  if (/\.toml$/i.test(path)) return (Bun.TOML.parse(await Bun.file(path).text()) ?? {}) as Dict
  return (await Bun.file(path).json()) as Dict
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists()
  } catch {
    return false
  }
}

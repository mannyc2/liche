import { extname } from 'node:path'
import type { Dict } from '@liche/core'

export async function readConfigFile(path: string): Promise<Dict> {
  const file = Bun.file(path)
  switch (extname(path).toLowerCase()) {
    case '.jsonc':
      return (Bun.JSONC.parse(await file.text()) ?? {}) as Dict
    case '.yaml':
    case '.yml':
      return (Bun.YAML.parse(await file.text()) ?? {}) as Dict
    case '.toml':
      return (Bun.TOML.parse(await file.text()) ?? {}) as Dict
    default:
      return (await file.json()) as Dict
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists()
  } catch {
    return false
  }
}

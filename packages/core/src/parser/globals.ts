import type { DisabledGlobal, Format } from '../types.js'
import { ParseError } from '../errors/error.js'

export type GlobalFlags = {
  configDisabled?: boolean | undefined
  configPath?: string | undefined
  filterOutput?: string | undefined
  format?: Format | undefined
  formatExplicit?: boolean | undefined
  fullOutput?: boolean | undefined
  help?: boolean | undefined
  json?: boolean | undefined
  llms?: boolean | undefined
  mcp?: boolean | undefined
  rest: string[]
  schema?: boolean | undefined
  tokenCount?: boolean | undefined
  tokenLimit?: number | undefined
  tokenOffset?: number | undefined
  version?: boolean | undefined
}

const validFormats: ReadonlySet<Format> = new Set(['toon', 'json', 'yaml', 'md', 'jsonl'])

export function parseGlobals(
  argv: string[],
  configFlag?: string | undefined,
  disabledGlobals?: readonly DisabledGlobal[] | undefined,
): GlobalFlags {
  const flags: GlobalFlags = { rest: [] }
  const valueFlags = new Set(['format', 'filter-output', 'token-limit', 'token-offset', 'config'])
  if (configFlag) valueFlags.add(configFlag)
  const disabled = new Set<string>(disabledGlobals ?? [])

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    const long = token.startsWith('--') ? token.slice(2) : undefined
    const [key, equalsValue] = long?.split(/=(.*)/s) ?? []
    const usesEquals = equalsValue !== undefined
    const needsValue = key !== undefined && valueFlags.has(key)
    let value: string | undefined
    if (usesEquals) value = equalsValue
    else if (needsValue) value = argv[++index]

    if (needsValue && (value === undefined || value === '')) {
      throw new ParseError({ message: `Missing value for flag: --${key}` })
    }

    if (token === '-h' || token === '--help') flags.help = true
    else if (token === '--json') {
      flags.json = true
      flags.formatExplicit = true
    } else if (key === 'format') {
      if (disabled.has('format')) {
        throw new ParseError({
          message: `--format is disabled for this CLI; use --json for machine output`,
        })
      }
      if (!validFormats.has(value as Format)) {
        throw new ParseError({
          message: `Invalid format: "${value}". Expected one of: ${[...validFormats].join(', ')}`,
        })
      }
      flags.format = value as Format
      flags.formatExplicit = true
    } else if (token === '--full-output') flags.fullOutput = true
    else if (token === '--version') flags.version = true
    else if (token === '--schema') flags.schema = true
    else if (token === '--llms') flags.llms = true
    else if (token === '--mcp') flags.mcp = true
    else if (token === '--token-count') flags.tokenCount = true
    else if (key === 'token-limit') flags.tokenLimit = parseFiniteNumber(value!, '--token-limit')
    else if (key === 'token-offset') flags.tokenOffset = parseFiniteNumber(value!, '--token-offset')
    else if (key === 'filter-output') flags.filterOutput = value
    else if (key === 'config' || (configFlag && key === configFlag)) flags.configPath = value
    else if (key === 'no-config' || (configFlag && key === `no-${configFlag}`)) flags.configDisabled = true
    else flags.rest.push(token)
  }

  return flags
}

function parseFiniteNumber(value: string, flag: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || value.trim() === '') {
    throw new ParseError({ message: `Invalid value for ${flag}: "${value}"` })
  }
  return n
}

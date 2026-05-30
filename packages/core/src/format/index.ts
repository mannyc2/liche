import type { BuiltInFormat, Format, OutputRenderContext, OutputRenderer } from '../types.js'

export { pick } from './filter.js'
export { formatCta } from './cta.js'

export const builtInFormatValues = ['json', 'yaml', 'md', 'jsonl', 'csv'] as const satisfies readonly BuiltInFormat[]

const jsonRenderer = defineOutputRenderer({
  mediaType: 'application/json',
  name: 'json',
  render(value) {
    return JSON.stringify(value ?? null, null, 2)
  },
})

const jsonlRenderer = defineOutputRenderer({
  mediaType: 'application/x-ndjson',
  name: 'jsonl',
  render(value) {
    return (Array.isArray(value) ? value : [value]).map((item: unknown) => JSON.stringify(item ?? null)).join('\n')
  },
})

const markdownRenderer = defineOutputRenderer({
  mediaType: 'text/markdown',
  name: 'md',
  render(value) {
    return typeof value === 'string' ? value : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
  },
})

const yamlRenderer = defineOutputRenderer({
  mediaType: 'application/yaml',
  name: 'yaml',
  render(value) {
    return Bun.YAML.stringify(value, null, 2).trimEnd()
  },
})

type CsvRecord = Record<string, unknown>

function isRecord(value: unknown): value is CsvRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function csvScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value) ?? ''
}

function csvCell(value: unknown): string {
  const cell = csvScalar(value)
  return /[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell
}

function csvHeaders(records: readonly CsvRecord[]): string[] {
  const headers: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue
      seen.add(key)
      headers.push(key)
    }
  }
  return headers
}

function csvRows(value: unknown): unknown[][] {
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    if (value.every(isRecord)) {
      const headers = csvHeaders(value)
      return [headers, ...value.map((record) => headers.map((header) => record[header]))]
    }
    if (value.every(Array.isArray)) {
      const width = Math.max(0, ...value.map((row) => row.length))
      const headers = Array.from({ length: width }, (_, index) => String(index))
      return [headers, ...value]
    }
    return [['value'], ...value.map((item) => [item])]
  }

  if (isRecord(value)) {
    const headers = csvHeaders([value])
    return [headers, headers.map((header) => value[header])]
  }

  return [['value'], [value]]
}

function formatCsv(value: unknown): string {
  return csvRows(value)
    .map((row) => row.map(csvCell).join(','))
    .join('\n')
}

const csvRenderer = defineOutputRenderer({
  mediaType: 'text/csv',
  name: 'csv',
  render: formatCsv,
})

const builtIns = Object.freeze([jsonRenderer, yamlRenderer, markdownRenderer, jsonlRenderer, csvRenderer])

export function defineOutputRenderer(renderer: OutputRenderer): OutputRenderer {
  return Object.freeze({ ...renderer })
}

export function defaultOutputRenderers(): readonly OutputRenderer[] {
  return builtIns
}

export function createOutputRendererRegistry(renderers: readonly OutputRenderer[] = []): readonly OutputRenderer[] {
  const customNames = new Set<string>()
  const registry = new Map<string, OutputRenderer>()
  for (const renderer of builtIns) registry.set(renderer.name, renderer)
  for (const renderer of renderers) {
    if (customNames.has(renderer.name)) throw new Error(`Multiple output renderers declare format "${renderer.name}"`)
    customNames.add(renderer.name)
    registry.set(renderer.name, defineOutputRenderer(renderer))
  }
  return Object.freeze([...registry.values()])
}

export function renderOutput(
  value: unknown,
  outputFormat: Format = 'json',
  renderers: readonly OutputRenderer[] = defaultOutputRenderers(),
  context: Partial<OutputRenderContext> = {},
): string {
  const renderer = renderers.find((candidate) => candidate.name === outputFormat)
  if (!renderer) throw new Error(`Unknown output renderer: "${outputFormat}"`)
  return renderer.render(value, { format: outputFormat, stage: context.stage ?? 'result' })
}

export function format(value: unknown, outputFormat: Format = 'json'): string {
  return renderOutput(value, outputFormat)
}

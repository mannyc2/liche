import type { BuiltInFormat, Format, OutputRenderContext, OutputRenderer } from '../types.js'

export { pick } from './filter.js'
export { formatCta } from './cta.js'

export const builtInFormatValues = ['json', 'yaml', 'md', 'jsonl'] as const satisfies readonly BuiltInFormat[]

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
    return (Array.isArray(value) ? value : [value]).map((item) => JSON.stringify(item ?? null)).join('\n')
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

const builtIns = Object.freeze([jsonRenderer, yamlRenderer, markdownRenderer, jsonlRenderer])

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

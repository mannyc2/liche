import type { Capability, Catalog } from './catalog.js'
import {
  capabilityAuthMetadata,
  capabilityInputSchema,
  capabilityOutputSchema,
  commandName,
  schemaSummary,
} from './generate-surface-utils.js'

export type GenerateDocsReferenceOptions = {
  generatorVersion: string
  canonicalCatalogDigest: string
  surfaceId?: string
}

export function generateDocsReference(
  catalog: Catalog,
  options: GenerateDocsReferenceOptions,
): string {
  const lines = [
    `# ${catalog.product.name} CLI reference`,
    '',
    catalog.product.description ?? '',
    '',
    `Version: \`${catalog.product.version}\``,
    '',
    `Catalog digest: \`${options.canonicalCatalogDigest}\``,
    '',
    '## Commands',
  ]

  const commands = catalog.capabilities.filter((capability) => capability.surfaces.docs && capability.surfaces.cli)
  if (commands.length === 0) {
    lines.push('', 'No documented CLI commands are declared.')
  } else {
    for (const cap of commands) lines.push('', ...docsCommandSection(catalog, cap))
  }

  if (catalog.config) {
    lines.push('', '## Config')
    const fields = schemaSummary(catalog.config.fields.jsonSchema)
    lines.push('', ...fieldTable(fields))
  }

  if (catalog.bindings.length > 0) {
    lines.push('', '## Config bindings')
    for (const binding of catalog.bindings) {
      lines.push('', `### ${binding.key}`, '', binding.doc ?? '')
      const fields = schemaSummary(binding.fields.jsonSchema)
      lines.push('', ...fieldTable(fields))
    }
  }

  return `${lines.join('\n')}\n`
}

function docsCommandSection(catalog: Catalog, cap: Capability): string[] {
  const input = schemaSummary(capabilityInputSchema(catalog, cap))
  const output = schemaSummary(capabilityOutputSchema(catalog, cap))
  const auth = capabilityAuthMetadata(catalog, cap)
  const lines = [
    `### ${commandName(cap)}`,
    '',
    cap.summary,
    '',
    `\`\`\`sh`,
    `${catalog.product.id} ${commandName(cap)}`,
    `\`\`\``,
  ]
  if (cap.description) lines.push('', cap.description)
  if (auth) {
    lines.push('', '**Requirements**', '')
    if (auth.required) lines.push('- Authentication required')
    if (auth.requiredPermissions?.length) {
      lines.push(`- Permissions: ${auth.requiredPermissions.map((value) => `\`${value}\``).join(', ')}`)
    }
    if (auth.contexts?.length) {
      lines.push(`- Contexts: ${auth.contexts.map((ctx) => `\`${ctx.id}\``).join(', ')}`)
    }
  }
  if (cap.examples.length > 0) {
    lines.push('', '**Examples**', '')
    for (const example of cap.examples) {
      const prefix = example.summary ? `${example.summary}: ` : ''
      lines.push(`- ${prefix}\`${example.command}\``)
    }
  }
  lines.push('', '**Input**', '', ...fieldTable(input))
  lines.push('', '**Output**', '', ...fieldTable(output))
  return lines
}

function fieldTable(fields: Record<string, string>): string[] {
  const entries = Object.entries(fields)
  if (entries.length === 0) return ['No fields.']
  return [
    '| Field | Description |',
    '| --- | --- |',
    ...entries.map(([key, description]) => `| \`${key}\` | ${description} |`),
  ]
}

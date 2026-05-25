import type { Capability, Catalog } from '../catalog/types.js'
import {
  capabilityAuthMetadata,
  capabilityInputSchema,
  capabilityOutputSchema,
  commandExecution,
  commandName,
  schemaSummary,
} from './surface-utils.js'

export type GenerateAgentReferenceOptions = {
  generatorVersion: string
  canonicalCatalogDigest: string
  surfaceId?: string
}

export function generateAgentReference(
  catalog: Catalog,
  options: GenerateAgentReferenceOptions,
): string {
  const lines = [
    `# ${catalog.product.name} agent reference`,
    '',
    `Product: \`${catalog.product.id}@${catalog.product.version}\``,
    '',
    `Catalog digest: \`${options.canonicalCatalogDigest}\``,
    '',
    `Generator: \`@liche/product ${options.generatorVersion}\``,
    '',
    'Use `--json` for machine-readable command output. Do not start interactive auth flows from agent or CI invocations.',
    '',
    '## Agent-visible commands',
  ]

  const commands = catalog.capabilities.filter((capability) => capability.surfaces.cli && capability.surfaces.agent)
  if (commands.length === 0) {
    lines.push('', 'No commands are marked agent-visible in this catalog.')
  } else {
    for (const cap of commands) lines.push('', ...agentCommandSection(catalog, cap))
  }

  return `${lines.join('\n')}\n`
}

function agentCommandSection(catalog: Catalog, cap: Capability): string[] {
  const input = schemaSummary(capabilityInputSchema(catalog, cap))
  const output = schemaSummary(capabilityOutputSchema(catalog, cap))
  const auth = capabilityAuthMetadata(catalog, cap)
  const execution = commandExecution(cap)
  const lines = [
    `### ${commandName(cap)}`,
    '',
    cap.summary,
    '',
    `Command: \`${catalog.product.id} ${commandName(cap)} --json\``,
    '',
    `Execution: \`${String(execution.mode)}\``,
  ]
  if (auth) {
    lines.push('', '**Auth and context**', '')
    if (auth.required) lines.push('- Auth: required')
    else lines.push('- Auth: not required')
    if (auth.envVars?.length) lines.push(`- Env vars: ${auth.envVars.map((value) => `\`${value}\``).join(', ')}`)
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
  lines.push('', '**Input options**', '', ...fieldLines(input))
  lines.push('', '**Output fields**', '', ...fieldLines(output))
  return lines
}

function fieldLines(fields: Record<string, string>): string[] {
  const entries = Object.entries(fields)
  if (entries.length === 0) return ['- none']
  return entries.map(([key, description]) => `- \`${key}\`: ${description}`)
}

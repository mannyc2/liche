import type { Capability, Catalog } from './catalog.js'
import {
  capabilityAuthMetadata,
  capabilityInputSchema,
  capabilityOutputSchema,
  commandExecution,
  commandName,
  jsonArtifact,
  toolName,
} from './generate-surface-utils.js'

export type GenerateMcpToolsOptions = {
  generatorVersion: string
  canonicalCatalogDigest: string
  surfaceId?: string
}

export function generateMcpTools(catalog: Catalog, options: GenerateMcpToolsOptions): string {
  return jsonArtifact({
    manifestVersion: 'lili.mcp-tools.v1',
    product: catalog.product,
    catalogDigest: options.canonicalCatalogDigest,
    generatorVersion: options.generatorVersion,
    surfaceId: options.surfaceId ?? 'mcp-tools',
    tools: catalog.capabilities
      .filter((capability) => capability.surfaces.cli && capability.surfaces.agent)
      .map((capability) => mcpTool(catalog, capability)),
  })
}

function mcpTool(catalog: Catalog, cap: Capability): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    name: toolName(cap),
    description: cap.description ?? cap.summary,
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'object', properties: {} },
        options: capabilityInputSchema(catalog, cap),
      },
      additionalProperties: false,
    },
    outputSchema: capabilityOutputSchema(catalog, cap),
    annotations: {
      capabilityId: cap.id,
      command: commandName(cap),
      execution: commandExecution(cap),
      effects: cap.effects,
      policy: cap.policy,
      examples: cap.examples,
    },
  }
  const auth = capabilityAuthMetadata(catalog, cap)
  if (auth) tool.auth = auth
  return tool
}

import type { Capability, Catalog } from '../catalog/types.js'
import {
  capabilityAuthMetadata,
  capabilityInputSchema,
  capabilityOutputSchema,
  commandExecution,
  commandName,
  jsonArtifact,
  toolName,
} from './surface-utils.js'

export type GenerateMcpToolsOptions = {
  generatorVersion: string
  canonicalCatalogDigest: string
  surfaceId?: string
}

export function generateMcpTools(catalog: Catalog, options: GenerateMcpToolsOptions): string {
  return jsonArtifact({
    manifestVersion: 'liche.mcp-tools.v1',
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
      ...mcpHintAnnotations(cap),
    },
  }
  const auth = capabilityAuthMetadata(catalog, cap)
  if (auth) tool.auth = auth
  return tool
}

function mcpHintAnnotations(cap: Capability): Record<string, boolean> {
  const effectKind = cap.effects?.kind
  const readOnly = effectKind === 'read' || effectKind === 'auth-session-read'
  const destructive = cap.policy?.dangerous === true || effectKind === 'delete' || effectKind === 'auth-session-delete'
  const idempotent = cap.effects?.idempotent ?? readOnly
  const openWorld =
    hasHttpTransport(cap) ||
    cap.requires.auth ||
    cap.requires.contexts.length > 0 ||
    effectKind === 'exec'

  return {
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: openWorld,
    readOnlyHint: readOnly,
  }
}

function hasHttpTransport(cap: Capability): boolean {
  return cap.kind === 'resource-operation'
    ? cap.http !== undefined
    : cap.execution.mode === 'remote-http'
}

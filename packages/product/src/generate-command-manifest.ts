import type { Capability, Catalog } from './catalog.js'
import {
  capabilityAuthMetadata,
  capabilityEnvSchema,
  capabilityInputSchema,
  capabilityOutputSchema,
  commandExecution,
  commandName,
  jsonArtifact,
} from './generate-surface-utils.js'

export type GenerateCommandManifestOptions = {
  generatorVersion: string
  canonicalCatalogDigest: string
  surfaceId?: string
}

export function generateCommandManifest(
  catalog: Catalog,
  options: GenerateCommandManifestOptions,
): string {
  return jsonArtifact({
    manifestVersion: 'liche.command-manifest.v1',
    product: catalog.product,
    catalogDigest: options.canonicalCatalogDigest,
    generatorVersion: options.generatorVersion,
    surfaceId: options.surfaceId ?? 'command-manifest',
    commands: catalog.capabilities
      .filter((capability) => capability.surfaces.cli)
      .map((capability) => commandEntry(catalog, capability)),
  })
}

function commandEntry(catalog: Catalog, cap: Capability): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: cap.id,
    kind: cap.kind,
    command: commandName(cap),
    commandPath: cap.command,
    summary: cap.summary,
    examples: cap.examples,
    execution: commandExecution(cap),
    schemas: {
      input: capabilityInputSchema(catalog, cap),
      output: capabilityOutputSchema(catalog, cap),
    },
    requires: cap.requires,
    effects: cap.effects,
    policy: cap.policy,
    surfaces: cap.surfaces,
  }
  if (cap.description) entry.description = cap.description
  if (cap.kind === 'command') entry.family = cap.family
  const env = capabilityEnvSchema(catalog, cap)
  if (env) (entry.schemas as Record<string, unknown>).env = env
  const auth = capabilityAuthMetadata(catalog, cap)
  if (auth) entry.auth = auth
  return entry
}

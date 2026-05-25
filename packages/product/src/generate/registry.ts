import type { Catalog } from '../catalog/types.js'
import { generateAgentReference } from './agent-reference.js'
import { generateCli } from './cli/index.js'
import { generateCommandManifest } from './command-manifest.js'
import { generateConfigSchema, shouldGenerateConfigSchema } from './config-schema.js'
import { generateDocsReference } from './docs-reference.js'
import { generateMcpTools } from './mcp-tools.js'
import { generateOpenapi } from './openapi.js'

export type SurfaceRenderCtx = {
  generatorVersion: string
  canonicalIrDigest: string
  generationOptionsDigest: string
  surfaceId: string
}

export type SurfaceSpec = {
  // Stable registry key (matches the default surface id and the corresponding
  // surfaceId/fileName option suffix in GenerateToDirOptions).
  key: string
  defaultId: string
  defaultFileName: string
  source: 'catalog' | 'openapi'
  enabled?: (catalog: Catalog) => boolean
  render: (catalog: Catalog, ctx: SurfaceRenderCtx) => string
}

export const ARTIFACT_REGISTRY: SurfaceSpec[] = [
  {
    key: 'cli',
    defaultId: 'cli',
    defaultFileName: 'liche.generated.ts',
    source: 'catalog',
    render: (catalog, ctx) =>
      generateCli(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalIrDigest: ctx.canonicalIrDigest,
        generationOptionsDigest: ctx.generationOptionsDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'openapi',
    defaultId: 'openapi',
    defaultFileName: 'liche.generated.openapi.json',
    source: 'openapi',
    render: (catalog, ctx) =>
      generateOpenapi(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalIrDigest: ctx.canonicalIrDigest,
        generationOptionsDigest: ctx.generationOptionsDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'commandManifest',
    defaultId: 'command-manifest',
    defaultFileName: 'liche.generated.commands.json',
    source: 'catalog',
    render: (catalog, ctx) =>
      generateCommandManifest(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalCatalogDigest: ctx.canonicalIrDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'mcpTools',
    defaultId: 'mcp-tools',
    defaultFileName: 'liche.generated.mcp.json',
    source: 'catalog',
    render: (catalog, ctx) =>
      generateMcpTools(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalCatalogDigest: ctx.canonicalIrDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'agentReference',
    defaultId: 'agent-reference',
    defaultFileName: 'liche.generated.agent.md',
    source: 'catalog',
    render: (catalog, ctx) =>
      generateAgentReference(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalCatalogDigest: ctx.canonicalIrDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'docsReference',
    defaultId: 'docs-reference',
    defaultFileName: 'liche.generated.docs.md',
    source: 'catalog',
    render: (catalog, ctx) =>
      generateDocsReference(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalCatalogDigest: ctx.canonicalIrDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'configSchema',
    defaultId: 'config-schema',
    defaultFileName: 'liche.generated.config.schema.json',
    source: 'catalog',
    enabled: shouldGenerateConfigSchema,
    render: (catalog, ctx) =>
      generateConfigSchema(catalog, {
        generatorVersion: ctx.generatorVersion,
        canonicalCatalogDigest: ctx.canonicalIrDigest,
        surfaceId: ctx.surfaceId,
      }),
  },
  {
    key: 'catalog',
    defaultId: 'catalog',
    defaultFileName: 'liche.generated.catalog.json',
    source: 'catalog',
    render: (catalog) => `${JSON.stringify(catalog, null, 2)}\n`,
  },
  {
    key: 'discovery',
    defaultId: 'discovery',
    defaultFileName: 'liche.generated.discovery.json',
    source: 'catalog',
    render: (catalog) => `${JSON.stringify(discoveryArtifact(catalog), null, 2)}\n`,
  },
]

function discoveryArtifact(catalog: Catalog): Record<string, unknown> {
  return {
    product: catalog.product,
    commands: catalog.capabilities
      .filter((capability) => capability.surfaces.cli)
      .map((capability) => ({
        id: capability.id,
        command: capability.command.join(' '),
        kind: capability.kind,
        summary: capability.summary,
      })),
    configFiles: catalog.config?.files ?? [],
    ops: {
      doctor: catalog.ops.doctor !== false,
      telemetry: catalog.ops.telemetry !== false
        ? {
            enabledEnvVar: catalog.ops.telemetry.enabledEnvVar,
            fileEnvVar: catalog.ops.telemetry.fileEnvVar,
          }
        : false,
      notices: {
        updates: catalog.ops.notices.updates.length,
        channels: catalog.ops.notices.channels.length,
        yanks: catalog.ops.notices.yanks.length,
      },
      release: releaseDiscovery(catalog),
    },
  }
}

function releaseDiscovery(catalog: Catalog): Record<string, unknown> | false {
  if (catalog.ops.release === false) return false
  const release = catalog.ops.release
  return {
    version: release.version,
    channel: release.channel ?? 'stable',
    latestVersion: release.latestVersion ?? release.version,
    installManagers: release.install?.map((entry) => entry.manager).sort() ?? [],
    packages: release.packages?.map((entry) => ({
      ecosystem: entry.ecosystem,
      kind: entry.kind,
      name: entry.name,
      version: entry.version,
      ...(entry.channel ? { channel: entry.channel } : undefined),
    })) ?? [],
    yankedVersions: release.yankedVersions?.map((entry) => entry.version).sort() ?? [],
  }
}

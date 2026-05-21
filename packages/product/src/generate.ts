import { join, relative } from 'node:path'
import { normalizeProduct, type Catalog } from './catalog.js'
import { canonicalDigest, renderCompileEntrypoint } from '@lili/build'
import { generateAgentReference } from './generate-agent-reference.js'
import { generateCli } from './generate-cli.js'
import { generateCommandManifest } from './generate-command-manifest.js'
import { generateConfigSchema, shouldGenerateConfigSchema } from './generate-config-schema.js'
import { generateDocsReference } from './generate-docs-reference.js'
import { generateMcpTools } from './generate-mcp-tools.js'
import { generateOpenapi } from './generate-openapi.js'
import {
  buildAuthManifest,
  type GeneratedSurfaceManifest,
  hashString,
  manifestEqualForSurface,
} from './manifest.js'
import type { Product } from './product.js'

export type GenerateToDirOptions = {
  outDir: string
  generatorVersion: string
  surfaceId?: string
  generatedFileName?: string
  compileEntryFileName?: string
  manifestFileName?: string
  openapiSurfaceId?: string
  openapiFileName?: string
  commandManifestSurfaceId?: string
  commandManifestFileName?: string
  mcpToolsSurfaceId?: string
  mcpToolsFileName?: string
  agentReferenceSurfaceId?: string
  agentReferenceFileName?: string
  docsReferenceSurfaceId?: string
  docsReferenceFileName?: string
  configSchemaSurfaceId?: string
  configSchemaFileName?: string
}

export type GenerateArtifact = {
  path: string
  contents: string
}

export type GenerateResult = {
  manifest: GeneratedSurfaceManifest
  manifestPath: string
  artifacts: Record<string, GenerateArtifact>
  compileEntrypointPath: string
  compileEntrypointSource: string
  // CLI-surface aliases for backward compatibility.
  generatedPath: string
  generatedSource: string
}

export type CheckResult = { ok: true } | { ok: false; drift: string[] }

type PreparedSurface = {
  id: string
  source: 'catalog' | 'openapi'
  fileName: string
  path: string
  contents: string
  generationOptionsDigest: string
}

type Prepared = {
  compileEntrypoint: GenerateArtifact
  inputDigest: string
  manifest: GeneratedSurfaceManifest
  manifestPath: string
  surfaces: PreparedSurface[]
}

function prepareGeneration(product: Product, options: GenerateToDirOptions): Prepared {
  const generatorVersion = options.generatorVersion
  const cliSurfaceId = options.surfaceId ?? 'cli'
  const cliFileName = options.generatedFileName ?? 'lili.generated.ts'
  const compileEntryFileName = options.compileEntryFileName ?? 'lili.compile-entry.ts'
  const openapiSurfaceId = options.openapiSurfaceId ?? 'openapi'
  const openapiFileName = options.openapiFileName ?? 'lili.generated.openapi.json'
  const commandManifestSurfaceId = options.commandManifestSurfaceId ?? 'command-manifest'
  const commandManifestFileName = options.commandManifestFileName ?? 'lili.generated.commands.json'
  const mcpToolsSurfaceId = options.mcpToolsSurfaceId ?? 'mcp-tools'
  const mcpToolsFileName = options.mcpToolsFileName ?? 'lili.generated.mcp.json'
  const agentReferenceSurfaceId = options.agentReferenceSurfaceId ?? 'agent-reference'
  const agentReferenceFileName = options.agentReferenceFileName ?? 'lili.generated.agent.md'
  const docsReferenceSurfaceId = options.docsReferenceSurfaceId ?? 'docs-reference'
  const docsReferenceFileName = options.docsReferenceFileName ?? 'lili.generated.docs.md'
  const configSchemaSurfaceId = options.configSchemaSurfaceId ?? 'config-schema'
  const configSchemaFileName = options.configSchemaFileName ?? 'lili.generated.config.schema.json'
  const manifestFileName = options.manifestFileName ?? 'lili.generated.manifest.json'

  const catalog: Catalog = normalizeProduct(product)
  const inputDigest = canonicalDigest(catalog)

  const cliGenerationOptionsDigest = canonicalDigest({
    surfaceId: cliSurfaceId,
    generatedFileName: cliFileName,
    manifestFileName,
  })
  const cliSource = generateCli(catalog, {
    generatorVersion,
    canonicalIrDigest: inputDigest,
    generationOptionsDigest: cliGenerationOptionsDigest,
    surfaceId: cliSurfaceId,
  })

  const openapiGenerationOptionsDigest = canonicalDigest({
    surfaceId: openapiSurfaceId,
    openapiFileName,
    manifestFileName,
  })
  const openapiSource = generateOpenapi(catalog, {
    generatorVersion,
    canonicalIrDigest: inputDigest,
    generationOptionsDigest: openapiGenerationOptionsDigest,
    surfaceId: openapiSurfaceId,
  })
  const commandManifestGenerationOptionsDigest = canonicalDigest({
    surfaceId: commandManifestSurfaceId,
    commandManifestFileName,
    manifestFileName,
  })
  const commandManifestSource = generateCommandManifest(catalog, {
    generatorVersion,
    canonicalCatalogDigest: inputDigest,
    surfaceId: commandManifestSurfaceId,
  })
  const mcpToolsGenerationOptionsDigest = canonicalDigest({
    surfaceId: mcpToolsSurfaceId,
    mcpToolsFileName,
    manifestFileName,
  })
  const mcpToolsSource = generateMcpTools(catalog, {
    generatorVersion,
    canonicalCatalogDigest: inputDigest,
    surfaceId: mcpToolsSurfaceId,
  })
  const agentReferenceGenerationOptionsDigest = canonicalDigest({
    surfaceId: agentReferenceSurfaceId,
    agentReferenceFileName,
    manifestFileName,
  })
  const agentReferenceSource = generateAgentReference(catalog, {
    generatorVersion,
    canonicalCatalogDigest: inputDigest,
    surfaceId: agentReferenceSurfaceId,
  })
  const docsReferenceGenerationOptionsDigest = canonicalDigest({
    surfaceId: docsReferenceSurfaceId,
    docsReferenceFileName,
    manifestFileName,
  })
  const docsReferenceSource = generateDocsReference(catalog, {
    generatorVersion,
    canonicalCatalogDigest: inputDigest,
    surfaceId: docsReferenceSurfaceId,
  })

  const surfaces: PreparedSurface[] = [
    {
      id: cliSurfaceId,
      source: 'catalog',
      fileName: cliFileName,
      path: join(options.outDir, cliFileName),
      contents: cliSource,
      generationOptionsDigest: cliGenerationOptionsDigest,
    },
    {
      id: openapiSurfaceId,
      source: 'openapi',
      fileName: openapiFileName,
      path: join(options.outDir, openapiFileName),
      contents: openapiSource,
      generationOptionsDigest: openapiGenerationOptionsDigest,
    },
    {
      id: commandManifestSurfaceId,
      source: 'catalog',
      fileName: commandManifestFileName,
      path: join(options.outDir, commandManifestFileName),
      contents: commandManifestSource,
      generationOptionsDigest: commandManifestGenerationOptionsDigest,
    },
    {
      id: mcpToolsSurfaceId,
      source: 'catalog',
      fileName: mcpToolsFileName,
      path: join(options.outDir, mcpToolsFileName),
      contents: mcpToolsSource,
      generationOptionsDigest: mcpToolsGenerationOptionsDigest,
    },
    {
      id: agentReferenceSurfaceId,
      source: 'catalog',
      fileName: agentReferenceFileName,
      path: join(options.outDir, agentReferenceFileName),
      contents: agentReferenceSource,
      generationOptionsDigest: agentReferenceGenerationOptionsDigest,
    },
    {
      id: docsReferenceSurfaceId,
      source: 'catalog',
      fileName: docsReferenceFileName,
      path: join(options.outDir, docsReferenceFileName),
      contents: docsReferenceSource,
      generationOptionsDigest: docsReferenceGenerationOptionsDigest,
    },
  ]
  if (shouldGenerateConfigSchema(catalog)) {
    const configSchemaGenerationOptionsDigest = canonicalDigest({
      surfaceId: configSchemaSurfaceId,
      configSchemaFileName,
      manifestFileName,
    })
    const configSchemaSource = generateConfigSchema(catalog, {
      generatorVersion,
      canonicalCatalogDigest: inputDigest,
      surfaceId: configSchemaSurfaceId,
    })
    surfaces.push({
      id: configSchemaSurfaceId,
      source: 'catalog',
      fileName: configSchemaFileName,
      path: join(options.outDir, configSchemaFileName),
      contents: configSchemaSource,
      generationOptionsDigest: configSchemaGenerationOptionsDigest,
    })
  }
  assertDistinctSurfaceConfig(surfaces, compileEntryFileName)

  const manifest: GeneratedSurfaceManifest = {
    manifestVersion: 1,
    schema: { name: catalog.product.id, version: catalog.product.version, digest: inputDigest },
    generatorVersion,
    auth: buildAuthManifest(catalog),
    surfaces: surfaces.map((s) => ({
      id: s.id,
      source: s.source,
      inputDigest,
      generationOptionsDigest: s.generationOptionsDigest,
      outputDigest: hashString(s.contents),
      artifacts: [s.fileName],
    })),
  }

  return {
    compileEntrypoint: {
      path: join(options.outDir, compileEntryFileName),
      contents: renderCompileEntrypoint(cliFileName),
    },
    inputDigest,
    manifest,
    manifestPath: join(options.outDir, manifestFileName),
    surfaces,
  }
}

function assertDistinctSurfaceConfig(surfaces: PreparedSurface[], compileEntryFileName: string): void {
  const ids = new Set<string>()
  const fileNames = new Set<string>()
  for (const surface of surfaces) {
    if (ids.has(surface.id)) {
      throw new Error(`Generated surface ids must be unique; duplicate '${surface.id}'`)
    }
    ids.add(surface.id)
    if (fileNames.has(surface.fileName)) {
      throw new Error(
        `Generated surface artifact filenames must be unique; duplicate '${surface.fileName}'`,
      )
    }
    fileNames.add(surface.fileName)
  }
  if (fileNames.has(compileEntryFileName)) {
    throw new Error(
      `Generated artifact filenames must be unique; duplicate '${compileEntryFileName}'`,
    )
  }
}

export async function generateToDir(
  product: Product,
  options: GenerateToDirOptions,
): Promise<GenerateResult> {
  const { compileEntrypoint, manifest, manifestPath, surfaces } = prepareGeneration(product, options)
  for (const surface of surfaces) {
    await Bun.write(surface.path, surface.contents)
  }
  await Bun.write(compileEntrypoint.path, compileEntrypoint.contents)
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const artifacts: Record<string, GenerateArtifact> = {}
  for (const surface of surfaces) {
    artifacts[surface.id] = { path: surface.path, contents: surface.contents }
  }
  const cli = artifacts[options.surfaceId ?? 'cli']!
  return {
    manifest,
    manifestPath,
    artifacts,
    compileEntrypointPath: compileEntrypoint.path,
    compileEntrypointSource: compileEntrypoint.contents,
    generatedPath: cli.path,
    generatedSource: cli.contents,
  }
}

export async function checkAgainstDir(
  product: Product,
  options: GenerateToDirOptions,
): Promise<CheckResult> {
  const { compileEntrypoint, manifest: expectedManifest, manifestPath, surfaces } = prepareGeneration(product, options)
  const drift: string[] = []

  for (const surface of surfaces) {
    const file = Bun.file(surface.path)
    if (!(await file.exists())) {
      drift.push(`generated file missing: ${relative(process.cwd(), surface.path)}`)
      continue
    }
    const actualContents = await file.text()
    if (actualContents !== surface.contents) {
      drift.push(
        `surface '${surface.id}' output digest mismatch (file: ${relative(process.cwd(), surface.path)})`,
      )
    }
  }

  const compileEntryFile = Bun.file(compileEntrypoint.path)
  if (!(await compileEntryFile.exists())) {
    drift.push(`generated compile entry missing: ${relative(process.cwd(), compileEntrypoint.path)}`)
  } else if (await compileEntryFile.text() !== compileEntrypoint.contents) {
    drift.push(
      `generated compile entry output digest mismatch (file: ${relative(process.cwd(), compileEntrypoint.path)})`,
    )
  }

  const manifestFile = Bun.file(manifestPath)
  if (!(await manifestFile.exists())) {
    drift.push(`manifest file missing: ${relative(process.cwd(), manifestPath)}`)
    return { ok: false, drift }
  }
  let actualManifest: GeneratedSurfaceManifest
  try {
    actualManifest = JSON.parse(await manifestFile.text()) as GeneratedSurfaceManifest
  } catch {
    drift.push(`manifest file is not valid JSON: ${relative(process.cwd(), manifestPath)}`)
    return { ok: false, drift }
  }
  for (const surface of surfaces) {
    const equality = manifestEqualForSurface(expectedManifest, actualManifest, surface.id)
    if (!equality.ok) {
      for (const r of equality.reasons) drift.push(r)
    }
  }

  return drift.length === 0 ? { ok: true } : { ok: false, drift: [...new Set(drift)] }
}

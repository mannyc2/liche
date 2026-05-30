import { join, relative } from 'node:path'
import { canonicalDigest, renderCompileEntrypoint } from '@liche/build'
import { normalizeProduct } from '../catalog/normalize.js'
import { buildAuthManifest, hashString, manifestEqualForSurface } from '../manifest/index.js'
import type { GeneratedSurfaceManifest } from '../manifest/index.js'
import type { RuntimeProduct } from '../product/types.js'
import type { Catalog } from '../catalog/types.js'
import { ARTIFACT_REGISTRY, type SurfaceSpec } from './registry.js'

// Per-surface override options. The shape is flat so callers can override
// any single surface's id or filename without touching the rest. The field
// names match the historical GenerateToDirOptions API.
export type GenerateToDirOptions = {
  outDir: string
  generatorVersion: string
  compileEntryFileName?: string
  manifestFileName?: string
  // CLI surface (the "default" surface)
  surfaceId?: string
  generatedFileName?: string
  // Per-surface overrides
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
  catalogSurfaceId?: string
  catalogFileName?: string
  discoverySurfaceId?: string
  discoveryFileName?: string
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

// Map from registry key to (id field, filename field) in GenerateToDirOptions.
// The CLI surface uses the unprefixed `surfaceId` / `generatedFileName` fields
// for backward compatibility.
const OPTION_FIELDS: Record<string, { id: keyof GenerateToDirOptions; file: keyof GenerateToDirOptions }> = {
  cli: { id: 'surfaceId', file: 'generatedFileName' },
  openapi: { id: 'openapiSurfaceId', file: 'openapiFileName' },
  commandManifest: { id: 'commandManifestSurfaceId', file: 'commandManifestFileName' },
  mcpTools: { id: 'mcpToolsSurfaceId', file: 'mcpToolsFileName' },
  agentReference: { id: 'agentReferenceSurfaceId', file: 'agentReferenceFileName' },
  docsReference: { id: 'docsReferenceSurfaceId', file: 'docsReferenceFileName' },
  configSchema: { id: 'configSchemaSurfaceId', file: 'configSchemaFileName' },
  catalog: { id: 'catalogSurfaceId', file: 'catalogFileName' },
  discovery: { id: 'discoverySurfaceId', file: 'discoveryFileName' },
}

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
  manifest: GeneratedSurfaceManifest
  manifestPath: string
  surfaces: PreparedSurface[]
  cliSurfaceId: string
}

function prepareGeneration(product: RuntimeProduct, options: GenerateToDirOptions): Prepared {
  const compileEntryFileName = options.compileEntryFileName ?? 'liche.compile-entry.ts'
  const manifestFileName = options.manifestFileName ?? 'liche.generated.manifest.json'
  const catalog = normalizeProduct(product)
  const inputDigest = canonicalDigest(catalog)

  const surfaces: PreparedSurface[] = []
  for (const spec of ARTIFACT_REGISTRY) {
    if (spec.enabled && !spec.enabled(catalog)) continue
    const surface = prepareSurface(spec, catalog, options, manifestFileName, inputDigest)
    surfaces.push(surface)
  }
  assertDistinctSurfaceConfig(surfaces, compileEntryFileName)

  const cliFileName =
    surfaces.find((s) => s.id === (options.surfaceId ?? 'cli'))?.fileName ??
    options.generatedFileName ??
    'liche.generated.ts'

  const manifest: GeneratedSurfaceManifest = {
    manifestVersion: 1,
    schema: { name: catalog.product.id, version: catalog.product.version, digest: inputDigest },
    generatorVersion: options.generatorVersion,
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
    manifest,
    manifestPath: join(options.outDir, manifestFileName),
    surfaces,
    cliSurfaceId: options.surfaceId ?? 'cli',
  }
}

function prepareSurface(
  spec: SurfaceSpec,
  catalog: Catalog,
  options: GenerateToDirOptions,
  manifestFileName: string,
  inputDigest: string,
): PreparedSurface {
  const fields = OPTION_FIELDS[spec.key]!
  const id = options[fields.id] ?? spec.defaultId
  const fileName = options[fields.file] ?? spec.defaultFileName
  // The options digest captures every input that would change rendered output
  // for this surface but not the catalog itself. Historical layout preserved
  // exactly (per-surface field-name keys) so digests remain byte-stable.
  const digestInput: Record<string, unknown> = { surfaceId: id, manifestFileName }
  digestInput[fields.file as string] = fileName
  const generationOptionsDigest = canonicalDigest(digestInput)
  const contents = spec.render(catalog, {
    generatorVersion: options.generatorVersion,
    canonicalIrDigest: inputDigest,
    generationOptionsDigest,
    surfaceId: id,
  })
  return {
    id,
    source: spec.source,
    fileName,
    path: join(options.outDir, fileName),
    contents,
    generationOptionsDigest,
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
      throw new Error(`Generated surface artifact filenames must be unique; duplicate '${surface.fileName}'`)
    }
    fileNames.add(surface.fileName)
  }
  if (fileNames.has(compileEntryFileName)) {
    throw new Error(`Generated artifact filenames must be unique; duplicate '${compileEntryFileName}'`)
  }
}

export async function generateToDir(product: RuntimeProduct, options: GenerateToDirOptions): Promise<GenerateResult> {
  const { compileEntrypoint, manifest, manifestPath, surfaces, cliSurfaceId } = prepareGeneration(product, options)
  for (const surface of surfaces) {
    await Bun.write(surface.path, surface.contents)
  }
  await Bun.write(compileEntrypoint.path, compileEntrypoint.contents)
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const artifacts: Record<string, GenerateArtifact> = {}
  for (const surface of surfaces) {
    artifacts[surface.id] = { path: surface.path, contents: surface.contents }
  }
  const cli = artifacts[cliSurfaceId]!
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

export async function checkAgainstDir(product: RuntimeProduct, options: GenerateToDirOptions): Promise<CheckResult> {
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
      drift.push(`surface '${surface.id}' output digest mismatch (file: ${relative(process.cwd(), surface.path)})`)
    }
  }

  const compileEntryFile = Bun.file(compileEntrypoint.path)
  if (!(await compileEntryFile.exists())) {
    drift.push(`generated compile entry missing: ${relative(process.cwd(), compileEntrypoint.path)}`)
  } else if ((await compileEntryFile.text()) !== compileEntrypoint.contents) {
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

// Re-export per-surface generators so consumers can call them directly.
export { generateAgentReference } from './agent-reference.js'
export type { GenerateAgentReferenceOptions } from './agent-reference.js'
export { generateCli } from './cli/index.js'
export type { GenerateOptions } from './cli/index.js'
export { generateCommandManifest } from './command-manifest.js'
export type { GenerateCommandManifestOptions } from './command-manifest.js'
export { generateConfigSchema, shouldGenerateConfigSchema } from './config-schema.js'
export type { GenerateConfigSchemaOptions } from './config-schema.js'
export { generateDocsReference } from './docs-reference.js'
export type { GenerateDocsReferenceOptions } from './docs-reference.js'
export { generateMcpTools } from './mcp-tools.js'
export type { GenerateMcpToolsOptions } from './mcp-tools.js'
export { generateOpenapi } from './openapi.js'
export type { GenerateOpenapiOptions } from './openapi.js'

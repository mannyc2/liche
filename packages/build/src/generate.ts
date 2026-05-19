import { join, relative } from 'node:path'
import { normalizeProduct, type Catalog } from './catalog.js'
import { canonicalDigest } from './digest.js'
import { generateCli } from './generate-cli.js'
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
  manifestFileName?: string
  openapiSurfaceId?: string
  openapiFileName?: string
}

export type GenerateArtifact = {
  path: string
  contents: string
}

export type GenerateResult = {
  manifest: GeneratedSurfaceManifest
  manifestPath: string
  artifacts: Record<string, GenerateArtifact>
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
  inputDigest: string
  manifest: GeneratedSurfaceManifest
  manifestPath: string
  surfaces: PreparedSurface[]
}

function prepareGeneration(product: Product, options: GenerateToDirOptions): Prepared {
  const generatorVersion = options.generatorVersion
  const cliSurfaceId = options.surfaceId ?? 'cli'
  const cliFileName = options.generatedFileName ?? 'lili.generated.ts'
  const openapiSurfaceId = options.openapiSurfaceId ?? 'openapi'
  const openapiFileName = options.openapiFileName ?? 'lili.generated.openapi.json'
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
  ]
  assertDistinctSurfaceConfig(surfaces)

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
    inputDigest,
    manifest,
    manifestPath: join(options.outDir, manifestFileName),
    surfaces,
  }
}

function assertDistinctSurfaceConfig(surfaces: PreparedSurface[]): void {
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
}

export async function generateToDir(
  product: Product,
  options: GenerateToDirOptions,
): Promise<GenerateResult> {
  const { manifest, manifestPath, surfaces } = prepareGeneration(product, options)
  for (const surface of surfaces) {
    await Bun.write(surface.path, surface.contents)
  }
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
    generatedPath: cli.path,
    generatedSource: cli.contents,
  }
}

export async function checkAgainstDir(
  product: Product,
  options: GenerateToDirOptions,
): Promise<CheckResult> {
  const { manifest: expectedManifest, manifestPath, surfaces } = prepareGeneration(product, options)
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

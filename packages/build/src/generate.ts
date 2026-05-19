import { join, relative } from 'node:path'
import { normalizeProduct, type Catalog } from './catalog.js'
import { canonicalDigest } from './digest.js'
import { generateCli } from './generate-cli.js'
import { type GeneratedSurfaceManifest, hashString, manifestEqualForSurface } from './manifest.js'
import type { Product } from './product.js'

export type GenerateToDirOptions = {
  outDir: string
  generatorVersion: string
  surfaceId?: string
  generatedFileName?: string
  manifestFileName?: string
}

export type GenerateResult = {
  manifest: GeneratedSurfaceManifest
  generatedPath: string
  manifestPath: string
  generatedSource: string
}

export type CheckResult = { ok: true } | { ok: false; drift: string[] }

type Prepared = {
  surfaceId: string
  source: string
  manifest: GeneratedSurfaceManifest
  generatedPath: string
  manifestPath: string
}

function prepareGeneration(product: Product, options: GenerateToDirOptions): Prepared {
  const surfaceId = options.surfaceId ?? 'cli'
  const generatedFileName = options.generatedFileName ?? 'lili.generated.ts'
  const manifestFileName = options.manifestFileName ?? 'lili.generated.manifest.json'

  const catalog: Catalog = normalizeProduct(product)
  const inputDigest = canonicalDigest(catalog)
  const generationOptionsDigest = canonicalDigest({
    surfaceId,
    generatedFileName,
    manifestFileName,
  })

  const source = generateCli(catalog, {
    generatorVersion: options.generatorVersion,
    canonicalIrDigest: inputDigest,
    generationOptionsDigest,
    surfaceId,
  })

  const manifest: GeneratedSurfaceManifest = {
    manifestVersion: 1,
    schema: { name: catalog.product.id, version: catalog.product.version, digest: inputDigest },
    generatorVersion: options.generatorVersion,
    surfaces: [
      {
        id: surfaceId,
        source: 'catalog',
        inputDigest,
        generationOptionsDigest,
        outputDigest: hashString(source),
        artifacts: [generatedFileName],
      },
    ],
  }

  return {
    surfaceId,
    source,
    manifest,
    generatedPath: join(options.outDir, generatedFileName),
    manifestPath: join(options.outDir, manifestFileName),
  }
}

export async function generateToDir(
  product: Product,
  options: GenerateToDirOptions,
): Promise<GenerateResult> {
  const { source, manifest, generatedPath, manifestPath } = prepareGeneration(product, options)
  await Bun.write(generatedPath, source)
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, generatedPath, manifestPath, generatedSource: source }
}

export async function checkAgainstDir(
  product: Product,
  options: GenerateToDirOptions,
): Promise<CheckResult> {
  const { surfaceId, source: expectedSource, manifest: expectedManifest, generatedPath, manifestPath } =
    prepareGeneration(product, options)
  const drift: string[] = []

  const generatedFile = Bun.file(generatedPath)
  if (!(await generatedFile.exists())) {
    drift.push(`generated file missing: ${relative(process.cwd(), generatedPath)}`)
    return { ok: false, drift }
  }
  const actualSource = await generatedFile.text()
  if (actualSource !== expectedSource) {
    drift.push(`surface '${surfaceId}' output digest mismatch (file: ${relative(process.cwd(), generatedPath)})`)
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
  const equality = manifestEqualForSurface(expectedManifest, actualManifest, surfaceId)
  if (!equality.ok) {
    for (const r of equality.reasons) drift.push(r)
  }

  return drift.length === 0 ? { ok: true } : { ok: false, drift }
}

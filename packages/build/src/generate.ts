import { join, relative } from 'node:path'
import { canonicalDigest } from './digest.js'
import { generateCli } from './generate-cli.js'
import { normalizeContract } from './ir.js'
import { type GeneratedSurfaceManifest, hashString, manifestEqualForSurface } from './manifest.js'
import type { Contract } from './schema.js'

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

export async function generateToDir(
  contract: Contract,
  options: GenerateToDirOptions,
): Promise<GenerateResult> {
  const surfaceId = options.surfaceId ?? 'cli'
  const generatedFileName = options.generatedFileName ?? 'lili.generated.ts'
  const manifestFileName = options.manifestFileName ?? 'lili.generated.manifest.json'

  const ir = normalizeContract(contract)
  const inputDigest = canonicalDigest(ir)
  const generationOptionsDigest = canonicalDigest({
    surfaceId,
    generatedFileName,
    manifestFileName,
  })

  const source = generateCli(ir, {
    generatorVersion: options.generatorVersion,
    canonicalIrDigest: inputDigest,
    generationOptionsDigest,
    surfaceId,
  })

  const manifest: GeneratedSurfaceManifest = {
    manifestVersion: 1,
    schema: { name: ir.name, version: ir.version, digest: inputDigest },
    generatorVersion: options.generatorVersion,
    surfaces: [
      {
        id: surfaceId,
        source: 'canonical-ir',
        inputDigest,
        generationOptionsDigest,
        outputDigest: hashString(source),
        artifacts: [generatedFileName],
      },
    ],
  }

  const generatedPath = join(options.outDir, generatedFileName)
  const manifestPath = join(options.outDir, manifestFileName)
  await Bun.write(generatedPath, source)
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return { manifest, generatedPath, manifestPath, generatedSource: source }
}

export type CheckResult = { ok: true } | { ok: false; drift: string[] }

export async function checkAgainstDir(
  contract: Contract,
  options: GenerateToDirOptions,
): Promise<CheckResult> {
  const surfaceId = options.surfaceId ?? 'cli'
  const generatedFileName = options.generatedFileName ?? 'lili.generated.ts'
  const manifestFileName = options.manifestFileName ?? 'lili.generated.manifest.json'

  const ir = normalizeContract(contract)
  const inputDigest = canonicalDigest(ir)
  const generationOptionsDigest = canonicalDigest({
    surfaceId,
    generatedFileName,
    manifestFileName,
  })
  const expectedSource = generateCli(ir, {
    generatorVersion: options.generatorVersion,
    canonicalIrDigest: inputDigest,
    generationOptionsDigest,
    surfaceId,
  })
  const expectedManifest: GeneratedSurfaceManifest = {
    manifestVersion: 1,
    schema: { name: ir.name, version: ir.version, digest: inputDigest },
    generatorVersion: options.generatorVersion,
    surfaces: [
      {
        id: surfaceId,
        source: 'canonical-ir',
        inputDigest,
        generationOptionsDigest,
        outputDigest: hashString(expectedSource),
        artifacts: [generatedFileName],
      },
    ],
  }

  const generatedPath = join(options.outDir, generatedFileName)
  const manifestPath = join(options.outDir, manifestFileName)
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

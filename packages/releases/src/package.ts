import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BinaryVerificationFailure, VerifiedBinary } from './binary.js'
import { verifyReleaseBinaries } from './binary.js'
import type {
  PackageArtifactVerificationFailure,
  VerifiedPackageArtifact,
} from './artifacts.js'
import { verifyPackageArtifacts } from './artifacts.js'
import type { CliReleaseManifest, PackageRecord } from './manifest.js'
import { parseCliReleaseManifest } from './manifest.js'
import type {
  ReleaseRenderer,
  ReleaseRendererInput,
  RendererConfigMap,
  RendererRegistry,
  RendererSelection,
  RendererSelectionFailure,
} from './renderers/index.js'
import { resolveReleaseRenderers } from './renderers/index.js'

export type PackageReleaseInput = {
  manifest: unknown
  binaryPaths: Record<string, string>
  renderers: RendererSelection
  rendererRegistry: RendererRegistry
  outDir: string
  rendererConfig?: RendererConfigMap
}

export type PackageReleaseFailureStage =
  | 'manifest'
  | 'binary'
  | 'renderer-selection'
  | 'renderer'
  | 'package-artifact'

export type PackageReleaseFailure = {
  stage: PackageReleaseFailureStage
  code: string
  message: string
  details?: Record<string, unknown>
}

export type PackageReleaseSuccess = {
  ok: true
  manifest: CliReleaseManifest
  binaries: VerifiedBinary[]
  packages: PackageRecord[]
  packageArtifacts: VerifiedPackageArtifact[]
}

export type PackageReleaseResult =
  | PackageReleaseSuccess
  | { ok: false; failures: PackageReleaseFailure[] }

function manifestFailure(message: string, details: Record<string, unknown>): PackageReleaseFailure {
  return {
    stage: 'manifest',
    code: 'MANIFEST_INVALID',
    message,
    details,
  }
}

function binaryFailure(failure: BinaryVerificationFailure): PackageReleaseFailure {
  const packaged: PackageReleaseFailure = {
    stage: 'binary',
    code: failure.code,
    message: failure.message,
  }
  if (failure.details) packaged.details = failure.details
  return packaged
}

function selectionFailure(failure: RendererSelectionFailure): PackageReleaseFailure {
  return {
    stage: 'renderer-selection',
    code: failure.code,
    message: failure.message,
    details: { renderer: failure.renderer, ...failure.details },
  }
}

function packageArtifactFailure(
  failure: PackageArtifactVerificationFailure,
): PackageReleaseFailure {
  return {
    stage: 'package-artifact',
    code: failure.code,
    message: failure.message,
    details: { packageId: failure.packageId, ...failure.details },
  }
}

function rendererInput(
  manifest: CliReleaseManifest,
  binaries: readonly VerifiedBinary[],
  outDir: string,
  config: unknown,
): ReleaseRendererInput {
  if (config === undefined) return { manifest, binaries, outDir }
  return { manifest, binaries, outDir, config }
}

async function renderPackages(
  manifest: CliReleaseManifest,
  binaries: readonly VerifiedBinary[],
  input: PackageReleaseInput,
  renderers: readonly ReleaseRenderer[],
): Promise<
  | { ok: true; packages: PackageRecord[]; artifacts: Array<{ packageId: string; path: string }> }
  | { ok: false; failure: PackageReleaseFailure }
> {
  const packages = [...manifest.packages]
  const artifacts: Array<{ packageId: string; path: string }> = []
  mkdirSync(input.outDir, { recursive: true })

  for (const renderer of renderers) {
    const rendererOutDir = join(input.outDir, renderer.id)
    mkdirSync(rendererOutDir, { recursive: true })
    const config = input.rendererConfig?.[renderer.id]
    try {
      const result = await renderer.render(rendererInput(manifest, binaries, rendererOutDir, config))
      for (const record of result.packages) {
        if (record.renderer !== renderer.id) {
          return {
            ok: false,
            failure: {
              stage: 'renderer',
              code: 'RENDERER_PACKAGE_MISMATCH',
              message: `renderer '${renderer.id}' returned package '${record.id}' for renderer '${record.renderer}'`,
              details: { renderer: renderer.id, packageId: record.id, packageRenderer: record.renderer },
            },
          }
        }
      }
      packages.push(...result.packages)
      artifacts.push(...result.artifacts)
    } catch (error) {
      return {
        ok: false,
        failure: {
          stage: 'renderer',
          code: 'RENDERER_FAILED',
          message: `renderer '${renderer.id}' failed`,
          details: { renderer: renderer.id, error: String(error) },
        },
      }
    }
  }

  return { ok: true, packages, artifacts }
}

export async function packageRelease(input: PackageReleaseInput): Promise<PackageReleaseResult> {
  const parsed = parseCliReleaseManifest(input.manifest)
  if (!parsed.ok) {
    return {
      ok: false,
      failures: [
        manifestFailure('release manifest is invalid', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
      ],
    }
  }

  const binaryResult = await verifyReleaseBinaries({
    manifest: parsed.manifest,
    binaryPaths: input.binaryPaths,
  })
  if (!binaryResult.ok) {
    return { ok: false, failures: binaryResult.failures.map(binaryFailure) }
  }

  const rendererResult = resolveReleaseRenderers({
    manifest: parsed.manifest,
    registry: input.rendererRegistry,
    selection: input.renderers,
    ...(input.rendererConfig ? { config: input.rendererConfig } : {}),
  })
  if (!rendererResult.ok) {
    return { ok: false, failures: rendererResult.failures.map(selectionFailure) }
  }

  if (rendererResult.renderers.length === 0) {
    return {
      ok: true,
      manifest: parsed.manifest,
      binaries: binaryResult.verified,
      packages: parsed.manifest.packages,
      packageArtifacts: [],
    }
  }

  const rendered = await renderPackages(
    parsed.manifest,
    binaryResult.verified,
    input,
    rendererResult.renderers,
  )
  if (!rendered.ok) return { ok: false, failures: [rendered.failure] }

  const packageArtifactResult = await verifyPackageArtifacts({
    packages: rendered.packages,
    artifacts: rendered.artifacts,
  })
  if (!packageArtifactResult.ok) {
    return { ok: false, failures: packageArtifactResult.failures.map(packageArtifactFailure) }
  }

  return {
    ok: true,
    manifest: parsed.manifest,
    binaries: binaryResult.verified,
    packages: rendered.packages,
    packageArtifacts: packageArtifactResult.verified,
  }
}

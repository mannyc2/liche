import type { CliReleaseManifest, PackageEcosystem, PackageRecord } from '../manifest/index.js'
import type { VerifiedBinary } from '../package/index.js'

export const PACKAGE_ECOSYSTEMS = ['npm', 'pypi', 'homebrew', 'scoop'] as const

const PACKAGE_ECOSYSTEM_SET = new Set<string>(PACKAGE_ECOSYSTEMS)

export type RendererSelection = 'all' | readonly string[]

export type RendererConfigMap = Partial<Record<PackageEcosystem, unknown>>

export type RenderPackageArtifact = {
  packageId: string
  path: string
}

export type RenderPackageResult = {
  packages: PackageRecord[]
  artifacts: RenderPackageArtifact[]
}

export type ReleaseRendererInput = {
  manifest: CliReleaseManifest
  binaries: readonly VerifiedBinary[]
  outDir: string
  config?: unknown
}

export type ReleaseRendererValidationInput = {
  manifest: CliReleaseManifest
  config?: unknown
}

export type ReleaseRenderer = {
  id: PackageEcosystem
  validate?: (input: ReleaseRendererValidationInput) => readonly string[] | void
  render: (input: ReleaseRendererInput) => Promise<RenderPackageResult> | RenderPackageResult
}

export type RendererRegistry = Partial<Record<PackageEcosystem, ReleaseRenderer>>

export type RendererSelectionFailureCode =
  | 'RENDERER_UNKNOWN'
  | 'RENDERER_DUPLICATE'
  | 'RENDERER_ID_MISMATCH'
  | 'RENDERER_CONFIG_INVALID'

export type RendererSelectionFailure = {
  renderer: string
  code: RendererSelectionFailureCode
  message: string
  details?: Record<string, unknown>
}

export type ResolveReleaseRenderersInput = {
  manifest: CliReleaseManifest
  registry: RendererRegistry
  selection: RendererSelection
  config?: RendererConfigMap
}

export type ResolveReleaseRenderersResult =
  | { ok: true; renderers: ReleaseRenderer[] }
  | { ok: false; failures: RendererSelectionFailure[] }

export function isPackageEcosystem(value: string): value is PackageEcosystem {
  return PACKAGE_ECOSYSTEM_SET.has(value)
}

function configuredRendererIds(registry: RendererRegistry): PackageEcosystem[] {
  return PACKAGE_ECOSYSTEMS.filter((id) => registry[id] !== undefined)
}

function validationInput(manifest: CliReleaseManifest, config: unknown): ReleaseRendererValidationInput {
  if (config === undefined) return { manifest }
  return { manifest, config }
}

export function resolveReleaseRenderers(input: ResolveReleaseRenderersInput): ResolveReleaseRenderersResult {
  const selectedIds = input.selection === 'all' ? configuredRendererIds(input.registry) : [...input.selection]
  const seen = new Set<string>()
  const failures: RendererSelectionFailure[] = []
  const renderers: ReleaseRenderer[] = []

  for (const selectedId of selectedIds) {
    if (seen.has(selectedId)) {
      failures.push({
        renderer: selectedId,
        code: 'RENDERER_DUPLICATE',
        message: `renderer '${selectedId}' was selected more than once`,
      })
      continue
    }
    seen.add(selectedId)

    if (!isPackageEcosystem(selectedId)) {
      failures.push({
        renderer: selectedId,
        code: 'RENDERER_UNKNOWN',
        message: `renderer '${selectedId}' is not a supported package ecosystem`,
      })
      continue
    }

    const renderer = input.registry[selectedId]
    if (!renderer) {
      failures.push({
        renderer: selectedId,
        code: 'RENDERER_UNKNOWN',
        message: `renderer '${selectedId}' is not registered`,
      })
      continue
    }

    if (renderer.id !== selectedId) {
      failures.push({
        renderer: selectedId,
        code: 'RENDERER_ID_MISMATCH',
        message: `renderer '${selectedId}' is registered with id '${renderer.id}'`,
        details: { registeredId: renderer.id },
      })
      continue
    }

    renderers.push(renderer)
  }

  if (failures.length > 0) return { ok: false, failures }

  for (const renderer of renderers) {
    const config = input.config?.[renderer.id]
    let validation: readonly string[]
    try {
      validation = renderer.validate?.(validationInput(input.manifest, config)) ?? []
    } catch (error) {
      failures.push({
        renderer: renderer.id,
        code: 'RENDERER_CONFIG_INVALID',
        message: `renderer '${renderer.id}' validation failed`,
        details: { error: String(error) },
      })
      continue
    }
    for (const message of validation) {
      failures.push({
        renderer: renderer.id,
        code: 'RENDERER_CONFIG_INVALID',
        message,
      })
    }
  }

  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, renderers }
}

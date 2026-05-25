import type { VerifiedPackageArtifact } from '../package/index.js'
import type {
  CliReleaseManifest,
  PackageEcosystem,
  PackageRecord,
} from '../manifest/index.js'
import { PACKAGE_ECOSYSTEMS, isPackageEcosystem } from '../renderers/index.js'
import type { PublishSelection } from './index.js'

export type NpmPublisherConfig = {
  registry?: string
  tag?: string
  access?: 'public' | 'restricted'
}

export type PypiPublisherConfig = {
  repositoryUrl?: string
}

export type GitRepoTarget = {
  owner: string
  repo: string
  branch?: string
}

export type ResolvedGitRepoTarget = {
  owner: string
  repo: string
  branch: string
}

export type HomebrewPublisherConfig = {
  tap: GitRepoTarget
  formulaPath?: string
}

export type ScoopPublisherConfig = {
  bucket: GitRepoTarget
  manifestPath?: string
}

export type PublisherConfigMap = {
  npm?: NpmPublisherConfig
  pypi?: PypiPublisherConfig
  homebrew?: HomebrewPublisherConfig
  scoop?: ScoopPublisherConfig
}

export type PlanReleasePublishInput = {
  manifest: CliReleaseManifest
  packages: readonly PackageRecord[]
  artifacts: readonly VerifiedPackageArtifact[]
  selection: PublishSelection
  config?: PublisherConfigMap
}

type PublishStepBase = {
  packageId: string
  ecosystem: PackageEcosystem
  artifactPath: string
  artifactFileName: string
  sha256: string
  size: number
  name: string
  version: string
}

export type NpmPublishStep = PublishStepBase & {
  kind: 'npm-publish'
  role: 'platform' | 'umbrella'
  registry: string
  tag: string
  access: 'public' | 'restricted'
}

export type PypiPublishStep = PublishStepBase & {
  kind: 'pypi-upload'
  repositoryUrl: string
}

export type HomebrewPublishStep = PublishStepBase & {
  kind: 'homebrew-write-formula'
  tap: ResolvedGitRepoTarget
  targetPath: string
}

export type ScoopPublishStep = PublishStepBase & {
  kind: 'scoop-write-manifest'
  bucket: ResolvedGitRepoTarget
  targetPath: string
}

export type PublishStep =
  | NpmPublishStep
  | PypiPublishStep
  | HomebrewPublishStep
  | ScoopPublishStep

export type PublishPlanFailureCode =
  | 'PUBLISHER_UNKNOWN'
  | 'PUBLISHER_DUPLICATE'
  | 'PUBLISHER_CONFIG_MISSING'
  | 'PUBLISHER_ARTIFACT_MISSING'
  | 'PUBLISHER_PACKAGE_UNGROUPED'

export type PublishPlanFailure = {
  publisher: string
  code: PublishPlanFailureCode
  message: string
  details?: Record<string, unknown>
}

export type ReleasePublishPlan = {
  dryRun: true
  manifestVersion: CliReleaseManifest['manifestVersion']
  releaseVersion: string
  subject: { id: string; name: string; version: string }
  steps: PublishStep[]
}

export type PlanReleasePublishResult =
  | { ok: true; plan: ReleasePublishPlan }
  | { ok: false; failures: PublishPlanFailure[] }

const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/'
const DEFAULT_NPM_TAG = 'latest'
const DEFAULT_PYPI_REPOSITORY = 'https://upload.pypi.org/legacy/'
const DEFAULT_BRANCH = 'main'

function resolveGitTarget(target: GitRepoTarget): ResolvedGitRepoTarget {
  return { owner: target.owner, repo: target.repo, branch: target.branch ?? DEFAULT_BRANCH }
}

function groupPackages(packages: readonly PackageRecord[]): Map<PackageEcosystem, PackageRecord[]> {
  const map = new Map<PackageEcosystem, PackageRecord[]>()
  for (const ecosystem of PACKAGE_ECOSYSTEMS) map.set(ecosystem, [])
  for (const record of packages) map.get(record.ecosystem)!.push(record)
  return map
}

function indexArtifacts(artifacts: readonly VerifiedPackageArtifact[]): Map<string, VerifiedPackageArtifact> {
  const map = new Map<string, VerifiedPackageArtifact>()
  for (const artifact of artifacts) map.set(artifact.packageId, artifact)
  return map
}

function resolveSelection(
  selection: PublishSelection,
  grouped: Map<PackageEcosystem, PackageRecord[]>,
  failures: PublishPlanFailure[],
): Set<PackageEcosystem> {
  if (selection === 'all') {
    return new Set(PACKAGE_ECOSYSTEMS.filter((id) => (grouped.get(id)?.length ?? 0) > 0))
  }
  const seen = new Set<string>()
  const resolved = new Set<PackageEcosystem>()
  for (const raw of selection) {
    if (seen.has(raw)) {
      failures.push({ publisher: raw, code: 'PUBLISHER_DUPLICATE', message: `publisher '${raw}' was selected more than once` })
      continue
    }
    seen.add(raw)
    if (!isPackageEcosystem(raw)) {
      failures.push({ publisher: raw, code: 'PUBLISHER_UNKNOWN', message: `publisher '${raw}' is not a supported package ecosystem` })
      continue
    }
    resolved.add(raw)
  }
  return resolved
}

function stepBase(record: PackageRecord, artifact: VerifiedPackageArtifact): PublishStepBase {
  return {
    packageId: record.id,
    ecosystem: record.ecosystem,
    artifactPath: artifact.path,
    artifactFileName: artifact.fileName,
    sha256: artifact.sha256,
    size: artifact.size,
    name: record.name,
    version: record.version,
  }
}

type BuildArgs<C> = {
  record: PackageRecord
  artifact: VerifiedPackageArtifact
  base: PublishStepBase
  config: C | undefined
}

// Per-ecosystem spec. `precheck` validates the publisher config and may emit
// failures; returning false aborts the ecosystem with no steps. `build` returns
// the step for one record (or null to skip with a recorded failure).
// `finalize` orders or rearranges the produced steps before merging.
type EcosystemSpec<Step extends PublishStep, Config> = {
  configFor: (config: PublisherConfigMap | undefined) => Config | undefined
  precheck?: (records: readonly PackageRecord[], config: Config | undefined, failures: PublishPlanFailure[]) => boolean
  build: (args: BuildArgs<Config>, failures: PublishPlanFailure[]) => Step | null
  finalize?: (steps: Step[]) => Step[]
}

function npmRole(record: PackageRecord): 'platform' | 'umbrella' | null {
  if (record.kind === 'npm-umbrella') return 'umbrella'
  if (record.kind === 'npm-platform') return 'platform'
  return null
}

const NPM_SPEC: EcosystemSpec<NpmPublishStep, NpmPublisherConfig> = {
  configFor: (config) => config?.npm,
  build: ({ record, base, config }, failures) => {
    const role = npmRole(record)
    if (!role) {
      failures.push({
        publisher: 'npm',
        code: 'PUBLISHER_PACKAGE_UNGROUPED',
        message: `npm package '${record.id}' has unknown kind '${record.kind}'`,
        details: { packageId: record.id, kind: record.kind },
      })
      return null
    }
    return {
      ...base,
      kind: 'npm-publish',
      role,
      registry: config?.registry ?? DEFAULT_NPM_REGISTRY,
      tag: config?.tag ?? DEFAULT_NPM_TAG,
      access: config?.access ?? 'public',
    }
  },
  // Platform packages publish before the umbrella so installers resolve
  // optionalDependencies on the umbrella's publish.
  finalize: (steps) => {
    const platform = steps.filter((s) => s.role === 'platform').sort((a, b) => a.name.localeCompare(b.name))
    const umbrella = steps.find((s) => s.role === 'umbrella')
    return umbrella ? [...platform, umbrella] : platform
  },
}

const PYPI_SPEC: EcosystemSpec<PypiPublishStep, PypiPublisherConfig> = {
  configFor: (config) => config?.pypi,
  build: ({ base, config }) => ({
    ...base,
    kind: 'pypi-upload',
    repositoryUrl: config?.repositoryUrl ?? DEFAULT_PYPI_REPOSITORY,
  }),
  finalize: (steps) => steps.sort((a, b) => a.artifactFileName.localeCompare(b.artifactFileName)),
}

const HOMEBREW_SPEC: EcosystemSpec<HomebrewPublishStep, HomebrewPublisherConfig> = {
  configFor: (config) => config?.homebrew,
  precheck: (records, config, failures) => {
    if (records.length === 0) return false
    if (!config?.tap) {
      failures.push({
        publisher: 'homebrew',
        code: 'PUBLISHER_CONFIG_MISSING',
        message: `publisher 'homebrew' requires a tap config (owner/repo)`,
      })
      return false
    }
    return true
  },
  build: ({ record, base, config }) => ({
    ...base,
    kind: 'homebrew-write-formula',
    tap: resolveGitTarget(config!.tap),
    targetPath: config!.formulaPath ?? `Formula/${record.name}.rb`,
  }),
  finalize: (steps) => steps.sort((a, b) => a.targetPath.localeCompare(b.targetPath)),
}

const SCOOP_SPEC: EcosystemSpec<ScoopPublishStep, ScoopPublisherConfig> = {
  configFor: (config) => config?.scoop,
  precheck: (records, config, failures) => {
    if (records.length === 0) return false
    if (!config?.bucket) {
      failures.push({
        publisher: 'scoop',
        code: 'PUBLISHER_CONFIG_MISSING',
        message: `publisher 'scoop' requires a bucket config (owner/repo)`,
      })
      return false
    }
    return true
  },
  build: ({ record, base, config }) => ({
    ...base,
    kind: 'scoop-write-manifest',
    bucket: resolveGitTarget(config!.bucket),
    targetPath: config!.manifestPath ?? `bucket/${record.name}.json`,
  }),
  finalize: (steps) => steps.sort((a, b) => a.targetPath.localeCompare(b.targetPath)),
}

const SPECS: { [E in PackageEcosystem]: EcosystemSpec<PublishStep, unknown> } = {
  npm: NPM_SPEC as EcosystemSpec<PublishStep, unknown>,
  pypi: PYPI_SPEC as EcosystemSpec<PublishStep, unknown>,
  homebrew: HOMEBREW_SPEC as EcosystemSpec<PublishStep, unknown>,
  scoop: SCOOP_SPEC as EcosystemSpec<PublishStep, unknown>,
}

function buildEcosystemSteps(
  ecosystem: PackageEcosystem,
  records: readonly PackageRecord[],
  artifacts: Map<string, VerifiedPackageArtifact>,
  config: PublisherConfigMap | undefined,
  failures: PublishPlanFailure[],
): PublishStep[] {
  const spec = SPECS[ecosystem]
  const ecoConfig = spec.configFor(config)
  if (spec.precheck && !spec.precheck(records, ecoConfig, failures)) return []

  const steps: PublishStep[] = []
  for (const record of records) {
    const artifact = artifacts.get(record.id)
    if (!artifact) {
      failures.push({
        publisher: ecosystem,
        code: 'PUBLISHER_ARTIFACT_MISSING',
        message: `publisher '${ecosystem}' has no verified artifact for package '${record.id}'`,
        details: { packageId: record.id },
      })
      continue
    }
    const built = spec.build({ record, artifact, base: stepBase(record, artifact), config: ecoConfig }, failures)
    if (built) steps.push(built)
  }
  return spec.finalize ? spec.finalize(steps) : steps
}

export function planReleasePublish(input: PlanReleasePublishInput): PlanReleasePublishResult {
  const failures: PublishPlanFailure[] = []
  const grouped = groupPackages(input.packages)
  const artifacts = indexArtifacts(input.artifacts)
  const selection = resolveSelection(input.selection, grouped, failures)
  if (failures.length > 0) return { ok: false, failures }

  const steps: PublishStep[] = []
  for (const ecosystem of PACKAGE_ECOSYSTEMS) {
    if (!selection.has(ecosystem)) continue
    const records = grouped.get(ecosystem) ?? []
    steps.push(...buildEcosystemSteps(ecosystem, records, artifacts, input.config, failures))
  }
  if (failures.length > 0) return { ok: false, failures }

  return {
    ok: true,
    plan: {
      dryRun: true,
      manifestVersion: input.manifest.manifestVersion,
      releaseVersion: input.manifest.release.version,
      subject: {
        id: input.manifest.subject.id,
        name: input.manifest.subject.name,
        version: input.manifest.subject.version,
      },
      steps,
    },
  }
}

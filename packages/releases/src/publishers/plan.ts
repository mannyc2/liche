import type { VerifiedPackageArtifact } from '../artifacts.js'
import type {
  CliReleaseManifest,
  PackageEcosystem,
  PackageRecord,
} from '../manifest.js'
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

function groupPackages(packages: readonly PackageRecord[]): Map<PackageEcosystem, PackageRecord[]> {
  const map = new Map<PackageEcosystem, PackageRecord[]>()
  for (const ecosystem of PACKAGE_ECOSYSTEMS) map.set(ecosystem, [])
  for (const record of packages) map.get(record.ecosystem)!.push(record)
  return map
}

function indexArtifacts(
  artifacts: readonly VerifiedPackageArtifact[],
): Map<string, VerifiedPackageArtifact> {
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
      failures.push({
        publisher: raw,
        code: 'PUBLISHER_DUPLICATE',
        message: `publisher '${raw}' was selected more than once`,
      })
      continue
    }
    seen.add(raw)
    if (!isPackageEcosystem(raw)) {
      failures.push({
        publisher: raw,
        code: 'PUBLISHER_UNKNOWN',
        message: `publisher '${raw}' is not a supported package ecosystem`,
      })
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

function missingArtifactFailure(
  publisher: PackageEcosystem,
  record: PackageRecord,
): PublishPlanFailure {
  return {
    publisher,
    code: 'PUBLISHER_ARTIFACT_MISSING',
    message: `publisher '${publisher}' has no verified artifact for package '${record.id}'`,
    details: { packageId: record.id },
  }
}

function npmRole(record: PackageRecord): 'platform' | 'umbrella' | null {
  if (record.kind === 'npm-umbrella') return 'umbrella'
  if (record.kind === 'npm-platform') return 'platform'
  return null
}

function npmSteps(
  records: readonly PackageRecord[],
  artifacts: Map<string, VerifiedPackageArtifact>,
  config: NpmPublisherConfig | undefined,
  failures: PublishPlanFailure[],
): NpmPublishStep[] {
  const registry = config?.registry ?? DEFAULT_NPM_REGISTRY
  const tag = config?.tag ?? DEFAULT_NPM_TAG
  const access = config?.access ?? 'public'

  const platform: NpmPublishStep[] = []
  let umbrella: NpmPublishStep | undefined

  for (const record of records) {
    const artifact = artifacts.get(record.id)
    if (!artifact) {
      failures.push(missingArtifactFailure('npm', record))
      continue
    }
    const role = npmRole(record)
    if (!role) {
      failures.push({
        publisher: 'npm',
        code: 'PUBLISHER_PACKAGE_UNGROUPED',
        message: `npm package '${record.id}' has unknown kind '${record.kind}'`,
        details: { packageId: record.id, kind: record.kind },
      })
      continue
    }
    const step: NpmPublishStep = {
      ...stepBase(record, artifact),
      kind: 'npm-publish',
      role,
      registry,
      tag,
      access,
    }
    if (role === 'umbrella') umbrella = step
    else platform.push(step)
  }

  platform.sort((a, b) => a.name.localeCompare(b.name))
  return umbrella ? [...platform, umbrella] : platform
}

function pypiSteps(
  records: readonly PackageRecord[],
  artifacts: Map<string, VerifiedPackageArtifact>,
  config: PypiPublisherConfig | undefined,
  failures: PublishPlanFailure[],
): PypiPublishStep[] {
  const repositoryUrl = config?.repositoryUrl ?? DEFAULT_PYPI_REPOSITORY
  const steps: PypiPublishStep[] = []
  for (const record of records) {
    const artifact = artifacts.get(record.id)
    if (!artifact) {
      failures.push(missingArtifactFailure('pypi', record))
      continue
    }
    steps.push({ ...stepBase(record, artifact), kind: 'pypi-upload', repositoryUrl })
  }
  steps.sort((a, b) => a.artifactFileName.localeCompare(b.artifactFileName))
  return steps
}

function homebrewSteps(
  records: readonly PackageRecord[],
  artifacts: Map<string, VerifiedPackageArtifact>,
  config: HomebrewPublisherConfig | undefined,
  failures: PublishPlanFailure[],
): HomebrewPublishStep[] {
  if (records.length === 0) return []
  if (!config?.tap) {
    failures.push({
      publisher: 'homebrew',
      code: 'PUBLISHER_CONFIG_MISSING',
      message: `publisher 'homebrew' requires a tap config (owner/repo)`,
    })
    return []
  }
  const tap: ResolvedGitRepoTarget = {
    owner: config.tap.owner,
    repo: config.tap.repo,
    branch: config.tap.branch ?? DEFAULT_BRANCH,
  }
  const steps: HomebrewPublishStep[] = []
  for (const record of records) {
    const artifact = artifacts.get(record.id)
    if (!artifact) {
      failures.push(missingArtifactFailure('homebrew', record))
      continue
    }
    const targetPath = config.formulaPath ?? `Formula/${record.name}.rb`
    steps.push({
      ...stepBase(record, artifact),
      kind: 'homebrew-write-formula',
      tap,
      targetPath,
    })
  }
  steps.sort((a, b) => a.targetPath.localeCompare(b.targetPath))
  return steps
}

function scoopSteps(
  records: readonly PackageRecord[],
  artifacts: Map<string, VerifiedPackageArtifact>,
  config: ScoopPublisherConfig | undefined,
  failures: PublishPlanFailure[],
): ScoopPublishStep[] {
  if (records.length === 0) return []
  if (!config?.bucket) {
    failures.push({
      publisher: 'scoop',
      code: 'PUBLISHER_CONFIG_MISSING',
      message: `publisher 'scoop' requires a bucket config (owner/repo)`,
    })
    return []
  }
  const bucket: ResolvedGitRepoTarget = {
    owner: config.bucket.owner,
    repo: config.bucket.repo,
    branch: config.bucket.branch ?? DEFAULT_BRANCH,
  }
  const steps: ScoopPublishStep[] = []
  for (const record of records) {
    const artifact = artifacts.get(record.id)
    if (!artifact) {
      failures.push(missingArtifactFailure('scoop', record))
      continue
    }
    const targetPath = config.manifestPath ?? `bucket/${record.name}.json`
    steps.push({
      ...stepBase(record, artifact),
      kind: 'scoop-write-manifest',
      bucket,
      targetPath,
    })
  }
  steps.sort((a, b) => a.targetPath.localeCompare(b.targetPath))
  return steps
}

const ECOSYSTEM_BUILDERS: Record<
  PackageEcosystem,
  (
    records: readonly PackageRecord[],
    artifacts: Map<string, VerifiedPackageArtifact>,
    config: PublisherConfigMap | undefined,
    failures: PublishPlanFailure[],
  ) => PublishStep[]
> = {
  npm: (records, artifacts, config, failures) =>
    npmSteps(records, artifacts, config?.npm, failures),
  pypi: (records, artifacts, config, failures) =>
    pypiSteps(records, artifacts, config?.pypi, failures),
  homebrew: (records, artifacts, config, failures) =>
    homebrewSteps(records, artifacts, config?.homebrew, failures),
  scoop: (records, artifacts, config, failures) =>
    scoopSteps(records, artifacts, config?.scoop, failures),
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
    steps.push(...ECOSYSTEM_BUILDERS[ecosystem](records, artifacts, input.config, failures))
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

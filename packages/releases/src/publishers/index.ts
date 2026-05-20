import type { VerifiedPackageArtifact } from '../artifacts.js'
import type { CliReleaseManifest, PackageEcosystem, PackageRecord } from '../manifest.js'

export type PublishSelection = 'all' | readonly string[]

export type PublishPackageInput = {
  manifest: CliReleaseManifest
  packages: readonly PackageRecord[]
  artifacts: readonly VerifiedPackageArtifact[]
  dryRun?: boolean
  config?: unknown
}

export type PublishPackageResult = {
  published: PackageRecord[]
  artifacts: VerifiedPackageArtifact[]
}

export type ReleasePublisherValidationInput = {
  manifest: CliReleaseManifest
  config?: unknown
}

export type ReleasePublisher = {
  id: PackageEcosystem
  validate?: (input: ReleasePublisherValidationInput) => readonly string[] | void
  publish: (input: PublishPackageInput) => Promise<PublishPackageResult> | PublishPackageResult
}

export type PublisherRegistry = Partial<Record<PackageEcosystem, ReleasePublisher>>

export { preflightReleasePublish } from './preflight.js'
export type {
  HomebrewCredentials,
  NpmCredentials,
  PreflightFailure,
  PreflightFailureCode,
  PreflightReleasePublishInput,
  PreflightReleasePublishResult,
  PublisherCredentials,
  PypiCredentials,
  ScoopCredentials,
} from './preflight.js'

export { planReleasePublish } from './plan.js'
export type {
  GitRepoTarget,
  HomebrewPublishStep,
  HomebrewPublisherConfig,
  NpmPublishStep,
  NpmPublisherConfig,
  PlanReleasePublishInput,
  PlanReleasePublishResult,
  PublishPlanFailure,
  PublishPlanFailureCode,
  PublishStep,
  PublisherConfigMap,
  PypiPublishStep,
  PypiPublisherConfig,
  ReleasePublishPlan,
  ResolvedGitRepoTarget,
  ScoopPublishStep,
  ScoopPublisherConfig,
} from './plan.js'

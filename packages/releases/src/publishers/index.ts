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

import type { VerifiedPackageArtifact } from '../package/index.js'
import type { CliReleaseManifest, PackageEcosystem, PackageRecord } from '../manifest/index.js'

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

export {
  PUBLISHER_ENV_NAMES,
  loadPublisherCredentialsFromEnv,
} from './credentials-env.js'
export type { EnvRecord, PublisherEnvNames } from './credentials-env.js'

export {
  DEFAULT_NPM_REGISTRY_AUDIENCE,
  OIDC_EXECUTOR_FAILURE_CODES,
  audienceForNpmRegistry,
  npmOidcExchangeUrl,
} from './oidc.js'
export type {
  OidcExchangeEnv,
  OidcExecutorFailureCode,
  OidcIdTokenFetcher,
  OidcIdTokenResult,
} from './oidc.js'

export { executeReleasePublish } from './executor.js'
export type {
  ExecuteFailure,
  ExecuteFailureCode,
  ExecuteReleasePublishInput,
  ExecuteReleasePublishResult,
  ExecutorFailure,
  ExecutorReceipt,
  HomebrewStepExecutor,
  NpmStepExecutor,
  PublisherExecutorRegistry,
  PypiStepExecutor,
  ScoopStepExecutor,
  StepExecutorInput,
  StepExecutorResult,
} from './executor.js'

export { OIDC_PROVIDERS, preflightReleasePublish } from './preflight.js'
export type {
  HomebrewCredentials,
  HomebrewTokenCredential,
  NpmCredentials,
  NpmTokenCredential,
  OidcCredential,
  OidcProvider,
  PreflightFailure,
  PreflightFailureCode,
  PreflightReleasePublishInput,
  PreflightReleasePublishResult,
  PublisherCredentials,
  PypiCredentials,
  PypiTokenCredential,
  ScoopCredentials,
  ScoopTokenCredential,
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

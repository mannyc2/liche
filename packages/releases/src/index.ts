// Core API: build records, release manifests, config, packaging, and verification.
export { BuildRecordSchema, parseBuildRecord } from './build-record.js'
export type { BuildRecord, ParseBuildRecordResult, RecordedBinary } from './build-record.js'

export { manifestFromBuildRecord } from './manifest-from-build-record.js'
export type { ReleaseDistConfig, ReleaseHost } from './manifest-from-build-record.js'

export { CliReleaseManifestSchema, parseCliReleaseManifest } from './manifest.js'
export type {
  BinaryTarget,
  CliReleaseManifest,
  CliReleaseManifestInput,
  PackageArtifact,
  PackageEcosystem,
  PackageRecord,
  ReleaseEnvelope,
  ReleaseMetadata,
  ReleaseSubject,
} from './manifest.js'

export {
  ReleasesConfigSchema,
  defineReleasesConfig,
} from './release-config.js'
export type {
  ReleasesConfig,
  ReleasesConfigInput,
} from './release-config.js'

export { verifyReleaseBinaries } from './binary.js'
export type { BinaryVerificationFailure, VerifiedBinary, VerifyBinaryInput, VerifyBinaryResult } from './binary.js'

export { verifyPackageArtifacts } from './artifacts.js'
export type {
  PackageArtifactVerificationFailure,
  VerifiedPackageArtifact,
  VerifyPackageArtifactsInput,
  VerifyPackageArtifactsResult,
} from './artifacts.js'

export { packageRelease } from './package.js'
export type { PackageReleaseFailure, PackageReleaseInput, PackageReleaseResult } from './package.js'

export { planReleaseYank } from './yank.js'
export type { ReleaseYankPlan, YankPackagePlan } from './yank.js'

// Extension API: custom renderers and custom publisher executors plug in here.
export {
  PACKAGE_ECOSYSTEMS,
  isPackageEcosystem,
  resolveReleaseRenderers,
} from './renderers/index.js'
export type {
  ReleaseRenderer,
  ReleaseRendererInput,
  RendererConfigMap,
  RendererRegistry,
  RendererSelection,
  RendererSelectionFailure,
  RenderPackageArtifact,
  RenderPackageResult,
} from './renderers/index.js'

export {
  DEFAULT_NPM_REGISTRY_AUDIENCE,
  audienceForNpmRegistry,
  executeReleasePublish,
  loadPublisherCredentialsFromEnv,
  npmOidcExchangeUrl,
  planReleasePublish,
  preflightReleasePublish,
} from './publishers/index.js'
export type {
  ExecuteFailure,
  ExecuteReleasePublishInput,
  ExecuteReleasePublishResult,
  EnvRecord,
  ExecutorFailure,
  ExecutorReceipt,
  HomebrewStepExecutor,
  NpmStepExecutor,
  OidcExchangeEnv,
  OidcExecutorFailureCode,
  OidcIdTokenFetcher,
  OidcIdTokenResult,
  PlanReleasePublishInput,
  PlanReleasePublishResult,
  PreflightFailure,
  PreflightReleasePublishInput,
  PreflightReleasePublishResult,
  PublisherConfigMap,
  PublisherCredentials,
  PublisherExecutorRegistry,
  PublishPlanFailure,
  PublishSelection,
  PublishStep,
  PypiStepExecutor,
  ReleasePublishPlan,
  ScoopStepExecutor,
  StepExecutorInput,
  StepExecutorResult,
} from './publishers/index.js'

// Internal/unstable API: exported for tests and advanced integrations, subject to change.
export {
  OIDC_EXECUTOR_FAILURE_CODES,
  OIDC_PROVIDERS,
  PUBLISHER_ENV_NAMES,
} from './publishers/index.js'
export type {
  ExecuteFailureCode,
  GitRepoTarget,
  HomebrewCredentials,
  HomebrewPublishStep,
  HomebrewPublisherConfig,
  HomebrewTokenCredential,
  NpmCredentials,
  NpmPublishStep,
  NpmPublisherConfig,
  NpmTokenCredential,
  OidcCredential,
  OidcProvider,
  PreflightFailureCode,
  PublisherEnvNames,
  PypiCredentials,
  PypiPublishStep,
  PypiPublisherConfig,
  PypiTokenCredential,
  ResolvedGitRepoTarget,
  ScoopCredentials,
  ScoopPublishStep,
  ScoopPublisherConfig,
  ScoopTokenCredential,
} from './publishers/index.js'

export { createOfficialFlowHandoff } from './official-flow.js'
export type { CreateOfficialFlowHandoffInput, OfficialFlowHandoff } from './official-flow.js'

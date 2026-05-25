// Core API: build records, release manifests, config, packaging, and verification.
export {
  BuildRecordSchema,
  CliReleaseManifestSchema,
  manifestFromBuildRecord,
  parseBuildRecord,
  parseCliReleaseManifest,
} from './manifest/index.js'
export type {
  BinaryTarget,
  BuildRecord,
  CliReleaseManifest,
  CliReleaseManifestInput,
  PackageArtifact,
  PackageEcosystem,
  PackageRecord,
  ParseBuildRecordResult,
  RecordedBinary,
  ReleaseDistConfig,
  ReleaseEnvelope,
  ReleaseHost,
  ReleaseMetadata,
  ReleaseSubject,
} from './manifest/index.js'

export {
  ReleasesConfigSchema,
  defineReleasesConfig,
} from './config.js'
export type {
  ReleasesConfig,
  ReleasesConfigInput,
} from './config.js'

export { packageRelease } from './package/index.js'
export type {
  PackageReleaseFailure,
  PackageReleaseInput,
  PackageReleaseResult,
} from './package/index.js'

export { verifyReleaseBinaries } from './package/verify-binary.js'
export type {
  BinaryVerificationFailure,
  VerifiedBinary,
  VerifyBinaryInput,
  VerifyBinaryResult,
} from './package/verify-binary.js'

export { verifyPackageArtifacts } from './package/verify-artifact.js'
export type {
  PackageArtifactVerificationFailure,
  VerifiedPackageArtifact,
  VerifyPackageArtifactsInput,
  VerifyPackageArtifactsResult,
} from './package/verify-artifact.js'

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

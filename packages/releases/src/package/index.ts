// Runtime API of the ./package subpath is intentionally just `packageRelease`.
// Verification helpers live behind the ./binary and ./artifacts subpaths.
// Type re-exports are erased and don't widen the runtime surface; they're here
// so internal consumers can import all package-domain types from one place.
export { packageRelease } from './orchestrator.js'
export type {
  PackageReleaseFailure,
  PackageReleaseFailureStage,
  PackageReleaseInput,
  PackageReleaseResult,
  PackageReleaseSuccess,
} from './orchestrator.js'

export type {
  BinaryVerificationFailure,
  BinaryVerificationFailureCode,
  VerifiedBinary,
  VerifyBinaryInput,
  VerifyBinaryResult,
} from './verify-binary.js'

export type {
  PackageArtifactVerificationFailure,
  PackageArtifactVerificationFailureCode,
  VerifiedPackageArtifact,
  VerifyPackageArtifactsInput,
  VerifyPackageArtifactsResult,
} from './verify-artifact.js'

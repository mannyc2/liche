export {
  Contract,
  DEFAULT_GENERATED_VOCABULARY,
  vocabulary,
} from './schema.js'
export { z } from 'zod'
export type {
  ContractInit,
  ContractRemote,
  Effects,
  Locality,
  LocalityModes,
  LocalOperation,
  Operation,
  OperationExample,
  OperationPolicy,
  RemoteBind,
  RemoteOperation,
  RuntimeContract,
  RuntimeValue,
  Vocabulary,
  VocabularyOverrides,
} from './schema.js'

export { normalizeContract } from './ir.js'
export type {
  ContractIR,
  ContractRemoteIR,
  LocalOperationIR,
  OperationEffectsIR,
  OperationExampleIR,
  OperationIR,
  OperationPolicyIR,
  RemoteBindIR,
  RemoteOperationIR,
  SchemaProjectionIR,
  VocabularyIR,
} from './ir.js'

export { canonicalDigest, canonicalize } from './digest.js'

export { lintContract } from './lints.js'
export type { LintIssue } from './lints.js'

export { generateCli } from './generate-cli.js'
export type { GenerateOptions } from './generate-cli.js'

export { generateToDir, checkAgainstDir } from './generate.js'
export type { GenerateToDirOptions, GenerateResult, CheckResult } from './generate.js'

export { hashString } from './manifest.js'
export type { GeneratedSurfaceManifest } from './manifest.js'

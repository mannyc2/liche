export {
  DEFAULT_GENERATED_VOCABULARY,
  defineProgram,
  operation,
  vocabulary,
} from './schema.js'
export type {
  Effects,
  Locality,
  LocalityModes,
  LocalOperation,
  Operation,
  OperationExample,
  OperationPolicy,
  Program,
  ProgramRemote,
  RemoteBind,
  RemoteOperation,
  RuntimeNormalizedProgram,
  Vocabulary,
  VocabularyOverrides,
} from './schema.js'

export { normalizeProgram } from './ir.js'
export type {
  LocalOperationIR,
  OperationEffectsIR,
  OperationExampleIR,
  OperationIR,
  OperationPolicyIR,
  ProgramIR,
  ProgramRemoteIR,
  RemoteBindIR,
  RemoteOperationIR,
  SchemaProjectionIR,
  VocabularyIR,
} from './ir.js'

export { canonicalDigest, canonicalize } from './digest.js'

export { lintProgram } from './lints.js'
export type { LintIssue } from './lints.js'

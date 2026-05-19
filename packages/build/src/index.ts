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

export type { JsonSchemaNode, LocalityIR, RemoteAuthIR } from './types.js'

export { canonicalDigest, canonicalize } from './digest.js'

export { lintContract } from './lints.js'
export type { LintIssue } from './lints.js'

export { generateCli } from './generate-cli.js'
export type { GenerateOptions } from './generate-cli.js'

export { generateToDir, checkAgainstDir } from './generate.js'
export type { GenerateToDirOptions, GenerateResult, CheckResult } from './generate.js'

export { hashString } from './manifest.js'
export type { GeneratedSurfaceManifest } from './manifest.js'

export { Field, FieldBuilder } from './field.js'
export type { FieldMutability, FieldType, NormalizedField } from './field.js'

export { Shape } from './shape.js'
export type { ListShape, ObjectShape } from './shape.js'

export { Command } from './command.js'
export type {
  CommandFamily,
  CommandSpec,
  Execution,
  HttpBind,
  HttpMethod,
  HttpSpec,
  HybridWorkflowExecution,
  LocalExecution,
  LocalInit,
  LocalNeed,
  RemoteHttpExecution,
  RemoteHttpInit,
  SurfaceHints,
  WorkflowInit,
  WorkflowStep,
} from './command.js'

export { Product, ResourceBuilder } from './product.js'
export type {
  BindingSpec,
  ProductCommandEntry,
  ProductInit,
  ProductScope,
  ResourceBuilderFn,
  ResourceInit,
  ResourceOperationEntry,
  ResourceOperationSpec,
  RuntimeProduct,
} from './product.js'

export { fieldToJsonSchema, normalizeProduct, resolveListShape } from './catalog.js'
export type {
  Capability,
  Catalog,
  CommandCapability,
  NormalizedBinding,
  NormalizedExecution,
  NormalizedHttpBind,
  NormalizedHttpSpec,
  NormalizedListShape,
  NormalizedObjectShape,
  NormalizedProductScope,
  NormalizedResource,
  NormalizedShape,
  NormalizedSurfaces,
  NormalizedWorkflowStep,
  ResolvedListShape,
  ResourceOperationCapability,
} from './catalog.js'

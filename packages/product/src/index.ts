export { z } from 'zod'

export type { JsonSchemaNode } from './types.js'

export { canonicalDigest, canonicalize } from '@liche/build'

export { lintCatalog } from './lints/index.js'
export type { LintIssue } from './lints/index.js'

export {
  checkAgainstDir,
  generateAgentReference,
  generateCli,
  generateCommandManifest,
  generateConfigSchema,
  generateDocsReference,
  generateMcpTools,
  generateOpenapi,
  generateToDir,
  shouldGenerateConfigSchema,
} from './generate/index.js'
export type {
  CheckResult,
  GenerateAgentReferenceOptions,
  GenerateArtifact,
  GenerateCommandManifestOptions,
  GenerateConfigSchemaOptions,
  GenerateDocsReferenceOptions,
  GenerateMcpToolsOptions,
  GenerateOpenapiOptions,
  GenerateOptions,
  GenerateResult,
  GenerateToDirOptions,
} from './generate/index.js'

export { conformProduct } from './conformance/index.js'
export type {
  ConformanceCase,
  ConformanceReport,
  ConformanceReportCase,
  ConformanceStatus,
  ConformProductOptions,
} from './conformance/index.js'

export { compileProduct } from './compile.js'
export type {
  CompileProductFailure,
  CompileProductOptions,
  CompileProductResult,
  CompileProductSuccess,
} from './compile.js'

export { buildAuthManifest, hashString } from './manifest/index.js'
export type { AuthManifestEntry, GeneratedSurfaceManifest, ManifestAuth } from './manifest/index.js'

export { Field, FieldBuilder, Shape } from './schema/index.js'
export type { FieldMutability, FieldType, ListShape, NormalizedField, ObjectShape } from './schema/index.js'

export { Command } from './command/index.js'
export type {
  CapabilityExample,
  CommandFamily,
  CommandSpec,
  EffectKind,
  EffectsSpec,
  Execution,
  HttpBind,
  HttpMethod,
  HttpSpec,
  HybridWorkflowExecution,
  LocalCommandDefinition,
  LocalExecution,
  LocalNeed,
  PolicySpec,
  RemoteHttpCommandDefinition,
  RemoteHttpExecution,
  SurfaceHints,
  WorkflowCommandDefinition,
  WorkflowStep,
} from './command/index.js'

export { createConfig } from './config/index.js'
export type { ConfigScopeSpec, ConfigScopesSpec, ProductConfigDefinition, ProductConfigSpec } from './config/index.js'

export { Runtime } from './runtime/index.js'
export type { ProductRemoteSpec, RuntimeValueSpec } from './runtime/index.js'

export type { ProductNotice, ProductOpsSpec, ProductPackageManager, ProductReleaseSpec } from './ops/index.js'

export { defineProduct } from './product/index.js'
export type {
  BindingSpec,
  DefinedProduct,
  ProductCommandEntry,
  ProductDefinition,
  ProductMetadata,
  ProductResource,
  ProductResourceDefinition,
  ProductResourceDefinitionEntry,
  ProductScope,
  ResourceMetadata,
  ResourceOperationEntry,
  ResourceOperationSpec,
  RuntimeProduct,
} from './product/index.js'

export { Auth } from './auth/index.js'
export type {
  AuthApiKeySpec,
  AuthBearerSpec,
  AuthCommandSpec,
  AuthIdentitySpec,
  AuthNoneSpec,
  AuthOAuthDeviceSpec,
  AuthSpec,
  ContextEnvSpec,
  ContextRemoteSpec,
  ContextSelectSpec,
  ContextSpec,
  EnvTokenSource,
  PermissionScopeSpec,
  PermissionSpec,
  ProductContextEntry,
  RequiresSpec,
  SessionTokenSource,
  TokenSource,
  TokenSourceMode,
} from './auth/index.js'

export { DEFAULT_GENERATED_VOCABULARY, vocabulary } from './schema/index.js'
export type { Vocabulary, VocabularyOverrides } from './schema/index.js'

export { fieldToJsonSchema, normalizeProduct, resolveListShape } from './catalog/index.js'
export type {
  Capability,
  Catalog,
  CommandCapability,
  NormalizedAuth,
  NormalizedBinding,
  NormalizedConfig,
  NormalizedConfigScopes,
  NormalizedContext,
  NormalizedExecution,
  NormalizedHttpBind,
  NormalizedHttpSpec,
  NormalizedListShape,
  NormalizedObjectShape,
  NormalizedOps,
  NormalizedPermission,
  NormalizedRemote,
  NormalizedRequires,
  NormalizedResource,
  NormalizedRuntimeValue,
  NormalizedShape,
  NormalizedSurfaces,
  NormalizedTokenSource,
  ResolvedListShape,
  ResourceOperationCapability,
} from './catalog/index.js'

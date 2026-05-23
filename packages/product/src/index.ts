export { z } from 'zod'

export type { JsonSchemaNode } from './types.js'

export { canonicalDigest, canonicalize } from '@lili/build'

export { lintCatalog } from './lints.js'
export type { LintIssue } from './lints.js'

export { generateCli } from './generate-cli.js'
export type { GenerateOptions } from './generate-cli.js'

export { generateOpenapi } from './generate-openapi.js'
export type { GenerateOpenapiOptions } from './generate-openapi.js'

export { generateCommandManifest } from './generate-command-manifest.js'
export type { GenerateCommandManifestOptions } from './generate-command-manifest.js'

export { generateMcpTools } from './generate-mcp-tools.js'
export type { GenerateMcpToolsOptions } from './generate-mcp-tools.js'

export { generateAgentReference } from './generate-agent-reference.js'
export type { GenerateAgentReferenceOptions } from './generate-agent-reference.js'

export { generateDocsReference } from './generate-docs-reference.js'
export type { GenerateDocsReferenceOptions } from './generate-docs-reference.js'

export { generateConfigSchema, shouldGenerateConfigSchema } from './generate-config-schema.js'
export type { GenerateConfigSchemaOptions } from './generate-config-schema.js'

export { generateToDir, checkAgainstDir } from './generate.js'
export type {
  CheckResult,
  GenerateArtifact,
  GenerateResult,
  GenerateToDirOptions,
} from './generate.js'

export { conformProduct } from './conformance.js'
export type {
  ConformanceCase,
  ConformanceReport,
  ConformanceReportCase,
  ConformanceStatus,
  ConformProductOptions,
} from './conformance.js'

export { compileProduct } from './compile.js'
export type {
  CompileProductFailure,
  CompileProductOptions,
  CompileProductResult,
  CompileProductSuccess,
} from './compile.js'

export { hashString, buildAuthManifest } from './manifest.js'
export type { AuthManifestEntry, GeneratedSurfaceManifest, ManifestAuth } from './manifest.js'

export { Field, FieldBuilder } from './field.js'
export type { FieldMutability, FieldType, NormalizedField } from './field.js'

export { Shape } from './shape.js'
export type { ListShape, ObjectShape } from './shape.js'

export { Command } from './command.js'
export type {
  CommandFamily,
  CapabilityExample,
  CommandSpec,
  EffectKind,
  EffectsSpec,
  Execution,
  HttpBind,
  HttpMethod,
  HttpSpec,
  HybridWorkflowExecution,
  LocalExecution,
  LocalCommandDefinition,
  LocalNeed,
  PolicySpec,
  RemoteHttpExecution,
  RemoteHttpCommandDefinition,
  SurfaceHints,
  WorkflowCommandDefinition,
  WorkflowStep,
} from './command.js'

export { createConfig } from './config.js'
export type {
  ConfigScopeSpec,
  ConfigScopesSpec,
  ProductConfigDefinition,
  ProductConfigSpec,
} from './config.js'

export { Runtime } from './runtime.js'
export type { ProductRemoteSpec, RuntimeValueSpec } from './runtime.js'

export type { ProductNotice, ProductOpsSpec, ProductPackageManager } from './ops.js'

export { defineProduct } from './product.js'
export type {
  BindingSpec,
  DefinedProduct,
  ProductDefinition,
  ProductCommandEntry,
  ProductMetadata,
  ProductResource,
  ProductResourceDefinition,
  ProductResourceDefinitionEntry,
  ProductScope,
  ResourceMetadata,
  ResourceOperationEntry,
  ResourceOperationSpec,
  RuntimeProduct,
} from './product.js'

export { Auth } from './auth.js'
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
} from './auth.js'

export { DEFAULT_GENERATED_VOCABULARY, vocabulary } from './vocabulary.js'
export type { Vocabulary, VocabularyOverrides } from './vocabulary.js'

export { fieldToJsonSchema, normalizeProduct, resolveListShape } from './catalog.js'
export type {
  Capability,
  Catalog,
  CommandCapability,
  NormalizedAuth,
  NormalizedBinding,
  NormalizedConfig,
  NormalizedConfigScopes,
  NormalizedContext,
  NormalizedContextSelect,
  NormalizedExecution,
  NormalizedCapabilityExample,
  NormalizedEffects,
  NormalizedHttpBind,
  NormalizedHttpSpec,
  NormalizedListShape,
  NormalizedObjectShape,
  NormalizedOps,
  NormalizedPermission,
  NormalizedPolicy,
  NormalizedProductScope,
  NormalizedRequires,
  NormalizedResource,
  NormalizedRemote,
  NormalizedRuntimeValue,
  NormalizedShape,
  NormalizedSurfaces,
  NormalizedTokenSource,
  NormalizedVocabulary,
  NormalizedWorkflowStep,
  ResolvedListShape,
  ResourceOperationCapability,
} from './catalog.js'

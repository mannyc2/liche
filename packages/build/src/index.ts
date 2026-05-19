export { z } from 'zod'

export type { JsonSchemaNode } from './types.js'

export { canonicalDigest, canonicalize } from './digest.js'

export { lintCatalog } from './lints.js'
export type { LintIssue } from './lints.js'

export { generateCli } from './generate-cli.js'
export type { GenerateOptions } from './generate-cli.js'

export { generateOpenapi } from './generate-openapi.js'
export type { GenerateOpenapiOptions } from './generate-openapi.js'

export { generateToDir, checkAgainstDir } from './generate.js'
export type {
  CheckResult,
  GenerateArtifact,
  GenerateResult,
  GenerateToDirOptions,
} from './generate.js'

export { hashString, buildAuthManifest } from './manifest.js'
export type { AuthManifestEntry, GeneratedSurfaceManifest, ManifestAuth } from './manifest.js'

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

export { Auth } from './auth.js'
export type {
  AuthApiKeySpec,
  AuthBearerSpec,
  AuthNoneSpec,
  AuthSpec,
  ContextEnvSpec,
  ContextRemoteSpec,
  ContextSelectSpec,
  ContextSpec,
  EnvTokenSource,
  ProductContextEntry,
  RequiresSpec,
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
  NormalizedContext,
  NormalizedContextSelect,
  NormalizedExecution,
  NormalizedHttpBind,
  NormalizedHttpSpec,
  NormalizedListShape,
  NormalizedObjectShape,
  NormalizedProductScope,
  NormalizedRequires,
  NormalizedResource,
  NormalizedShape,
  NormalizedSurfaces,
  NormalizedTokenSource,
  NormalizedVocabulary,
  NormalizedWorkflowStep,
  ResolvedListShape,
  ResourceOperationCapability,
} from './catalog.js'

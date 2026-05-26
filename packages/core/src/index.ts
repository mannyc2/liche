export { defineCli, defineCommand, defineExtension, defineGlobal, getCliState } from './cli/create.js'
export { dispatch, run } from './cli/dispatch.js'
export type { DispatchOptions } from './cli/dispatch.js'
export { help, outputControls, reflectionControls, version } from './cli/controls.js'
export type { HelpControlOptions, OutputControlsOptions, ReflectionControlsOptions } from './cli/controls.js'
export { middleware } from './cli/context.js'
export { defineOutputRenderer } from './format/index.js'
export { defaultHelpRenderer } from './help/render.js'
export { z, parseSchema } from './schema/zod.js'
export { ParseError, ValidationError } from './errors/error.js'

// Internals exposed for first-party extensions that contribute serve/fetch handlers.
export { execute } from './cli/execute.js'
export { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from './cli/lifecycle.js'
export { collectCommandContracts, manifest, manifestEnvelope, mcpToolName, selectCommand } from './command/registry.js'

export * as Formatter from './format/index.js'

export { commandError, fail, ok } from './errors/error.js'

export { secret } from './auth/secret.js'
export { applyAuth } from './auth/resolve.js'
export { callHttpOperation, serializeHttpOperationRequest } from './http/index.js'
export type { SecretString } from './auth/secret.js'
export type {
  AuthCommandRuntime,
  AuthCredential,
  AuthIdentityProbeInput,
  AuthProviderRuntime,
  ContextRuntime,
  EnvTokenSourceSpec,
  IdentityRuntime,
  OAuthDeviceRuntime,
  SessionTokenSourceSpec,
  TokenSourceSpec,
} from './auth/types.js'

export type {
  Awaitable,
  BeforeExecuteHook,
  BuiltInFormat,
  CliEvent,
  CliEventCommand,
  CliEventCompletion,
  CliEventError,
  CliEventRegistration,
  CliEventSubscriber,
  CliEventSubscription,
  CliEventSurface,
  CliEventTarget,
  CliEventType,
  CliExtension,
  CliState,
  CliHookRegistration,
  CommandAuthMetadata,
  CommandContract,
  CommandEffectKind,
  CommandEffects,
  CliInstance,
  CommandError,
  CommandPolicy,
  CommandSafety,
  CommandInput,
  Cta,
  CtaBlock,
  DeclarativeCommand,
  DeclarativeCommandRunContext,
  DefineCliOptions,
  Dict,
  Example,
  FetchHandler,
  FetchRoute,
  FetchRouteInput,
  FieldError,
  Format,
  GlobalFlags,
  GlobalInputDefinition,
  GlobalInputType,
  GlobalOptions,
  HelpCommand,
  HelpField,
  HelpGlobal,
  HelpModel,
  HelpRenderContext,
  HelpRenderer,
  InferSchema,
  InputSourceBinding,
  InputSourceProvider,
  InputSourceProvenance,
  InputSourceResolveInput,
  MiddlewareContext,
  MiddlewareHandler,
  OptionValueSource,
  OutputPolicy,
  OutputRenderContext,
  OutputRenderer,
  OutputRenderStage,
  OutputTransform,
  OutputTransformInput,
  PrepareContextHook,
  PrepareContextInput,
  PrepareContextResult,
  ResolvedInputSource,
  Result,
  ResultMeta,
  RunContext,
  Schema,
  ServeHandler,
  ServeHandlerInput,
  ServeOptions,
  SourceInspector,
  SkillDefinition,
  Usage,
  UsageObject,
} from './types.js'
export type {
  HttpAuth,
  HttpFetch,
  HttpMethod,
  HttpOperationBind,
  HttpOperationCall,
  HttpOperationRequestSpec,
  RemoteErrorDetails,
  RuntimeValue,
  SerializedHttpRequest,
} from './http/index.js'

import type { z } from 'zod'

export type Dict<T = unknown> = Record<string, T>
export type Awaitable<T> = T | Promise<T>
export type Format = 'json' | 'yaml' | 'md' | 'jsonl'
export type DisabledGlobal = 'format'
export type OutputPolicy = 'all' | 'agent-only'
export type InvocationKind = 'cli' | 'ci' | 'agent' | 'mcp'
export type GlobalOptions = {
  nonInteractive?: boolean | undefined
  noSession?: boolean | undefined
  profile?: string | undefined
}
export type Schema<T = unknown> = z.ZodType<T>
export type InferSchema<T> = T extends z.ZodType<infer O> ? O : unknown

export type ConfigScopeDeclaration =
  | boolean
  | {
      discoverUpwards?: boolean | undefined
      xdg?: boolean | undefined
    }

export type ConfigScopesDeclaration = {
  project?: ConfigScopeDeclaration | undefined
  user?: ConfigScopeDeclaration | undefined
}

export type ConfigObjectDefinition<T = Record<string, unknown>> = {
  kind: 'lili.config.object'
  files?: readonly string[] | undefined
  flag?: string | undefined
  schema?: Schema<T> | undefined
  scopes?: ConfigScopesDeclaration | undefined
}

export type ConfigDefinition<T = Record<string, unknown>> = ConfigObjectDefinition<T>

export type ConfigValueSource =
  | { kind: 'default' }
  | { kind: 'explicit-file'; path: string }
  | { kind: 'project-file'; path: string }
  | { kind: 'user-file'; path: string }

export type OptionValueSource =
  | 'argv'
  | 'env'
  | 'explicit-config'
  | 'project-config'
  | 'user-config'
  | 'default'

export type SourceInspector = {
  config(path: string): ConfigValueSource
  option(name: string): OptionValueSource
}

export type Cta =
  | string
  | {
      args?: Record<string, unknown> | undefined
      command: string
      description?: string | undefined
      options?: Record<string, unknown> | undefined
    }

export type CtaBlock = {
  commands?: Cta[] | undefined
  description?: string | undefined
}

export type FieldError = {
  path: string
  message: string
  code?: string | undefined
  missing?: boolean | undefined
  expected?: string | undefined
  received?: string | undefined
}

export type CommandError = {
  code: string
  details?: Record<string, unknown> | undefined
  exitCode?: number | undefined
  fieldErrors?: FieldError[] | undefined
  hint?: string | undefined
  message: string
  retryable?: boolean | undefined
  status?: number | undefined
}

export type ResultMeta = Record<string, unknown> & {
  cta?: CtaBlock | undefined
}

export type Result =
  | { ok: true; data: unknown; meta?: ResultMeta | undefined }
  | { ok: false; error: CommandError; meta?: ResultMeta | undefined }

export type CommandContract = {
  agent?: boolean | undefined
  aliases?: readonly string[] | undefined
  auth?: CommandAuthMetadata | undefined
  description?: string | undefined
  effects?: CommandEffects | undefined
  examples?: readonly Example[] | undefined
  hint?: string | undefined
  name: string
  optionConfig?: Record<string, string> | undefined
  outputPolicy?: OutputPolicy | undefined
  path?: readonly string[] | undefined
  policy?: CommandPolicy | undefined
  safety?: CommandSafety | undefined
  schema?: unknown
  summary?: string | undefined
  usage?: readonly Usage[] | undefined
}

export type CommandEffectKind =
  | 'read'
  | 'write'
  | 'delete'
  | 'exec'
  | 'auth-session'
  | 'auth-session-read'
  | 'auth-session-write'
  | 'auth-session-delete'
  | 'auth-context-write'

export type CommandEffects = {
  kind: CommandEffectKind
  idempotent?: boolean | undefined
}

export type CommandPolicy = {
  conformanceEligible?: boolean | undefined
  dangerous?: boolean | undefined
  requiresConfirmation?: boolean | undefined
}

export type CommandSafety = {
  auth?: 'none' | 'optional' | 'required' | undefined
  destructive?: boolean | undefined
  idempotent?: boolean | undefined
  interactive?: 'never' | 'optional' | 'required' | undefined
  openWorld?: boolean | undefined
  readOnly?: boolean | undefined
}

export type CommandAuthMetadata = {
  required: boolean
  status: 'not-required' | 'requires-runtime-resolution'
  providerId?: string | undefined
  envVars?: readonly string[] | undefined
  contexts?: readonly { id: string; envVar?: string | undefined; flag?: string | undefined }[] | undefined
  requiredPermissions?: readonly string[] | undefined
  requiredScopes?: readonly string[] | undefined
}

export type CommandManifest = {
  commands: CommandContract[]
  description?: string | undefined
  name: string
  version?: string | undefined
}

export type RunContext<
  A = Record<string, unknown>,
  O = Record<string, unknown>,
  E = Record<string, unknown>,
  V = Record<string, unknown>,
> = {
  agent: boolean
  args: A
  config: Record<string, unknown>
  displayName: string
  env: E
  error(input: {
    code: string
    cta?: CtaBlock | undefined
    exitCode?: number | undefined
    hint?: string | undefined
    message: string
    retryable?: boolean | undefined
  }): never
  format: Format
  formatExplicit: boolean
  global: GlobalOptions
  invocation: InvocationKind
  isTty: boolean
  name: string
  ok(data?: unknown, meta?: ResultMeta): never
  options: O
  set(key: string, value: unknown): void
  sources: SourceInspector
  var: V
}

export type MiddlewareContext = RunContext & { result?: Result | undefined }
export type MiddlewareHandler = (
  context: MiddlewareContext,
  next: () => Promise<void>,
) => Awaitable<void | Result | unknown>

export type CliEventType =
  | 'command.selected'
  | 'command.started'
  | 'command.completed'
  | 'command.failed'
  | 'validation.failed'
  | 'parse.failed'
  | 'command.not_found'
  | 'help.rendered'
  | 'version.rendered'
  | 'completion.generated'
  | 'schema.generated'
  | 'mcp.initialize'
  | 'mcp.tools_listed'
  | 'mcp.tool_call.started'
  | 'mcp.tool_call.completed'
  | 'mcp.tool_call.failed'
  | 'hook.failed'
export type CliEventTarget = CliEventType | '*'
export type CliEventCommand = {
  id: string
  path: readonly string[]
}
export type CliEventCompletion = {
  shell?: string | undefined
  suggestionCount?: number | undefined
}
export type CliEventError = {
  code: string
  exitCode?: number | undefined
  fieldErrorCount?: number | undefined
  retryable?: boolean | undefined
  status?: number | undefined
}
export type CliEventMcp = {
  method: 'initialize' | 'tools/list' | 'tools/call'
  toolCount?: number | undefined
}
export type CliEventSurface = {
  kind: 'command' | 'completion' | 'help' | 'mcp' | 'parse' | 'schema' | 'version'
  name?: string | undefined
}
export type CliEvent = {
  agent: boolean
  cli: {
    name: string
    version?: string | undefined
  }
  command?: CliEventCommand | undefined
  completion?: CliEventCompletion | undefined
  durationMs?: number | undefined
  error?: CliEventError | undefined
  exitCode?: number | undefined
  format: Format
  formatExplicit: boolean
  invocation: InvocationKind
  mcp?: CliEventMcp | undefined
  occurredAt: string
  result?: 'success' | 'user_error' | 'system_error' | 'canceled' | undefined
  surface?: CliEventSurface | undefined
  type: CliEventType
}
export type CliEventSubscriber = (event: Readonly<CliEvent>) => Awaitable<void>
export type CliEventRegistration =
  | CliEventSubscriber
  | {
      subscriber: CliEventSubscriber
      target: CliEventTarget
    }
export type CliEventSubscription = {
  subscriber: CliEventSubscriber
  target: CliEventTarget
}

export type BeforeExecuteHook = (context: MiddlewareContext) => Awaitable<void>
export type CliHookType = 'beforeExecute'
export type CliHookHandler<T extends CliHookType = CliHookType> = T extends 'beforeExecute' ? BeforeExecuteHook : never
export type CliHookRegistration = {
  beforeExecute?: BeforeExecuteHook | readonly BeforeExecuteHook[] | undefined
}
export type CliHooks = {
  beforeExecute: BeforeExecuteHook[]
}

export type FetchHandler = (request: Request) => Awaitable<Response>
export type Example =
  | string
  | {
      args?: Record<string, unknown>
      command?: string
      description?: string
      options?: Record<string, unknown>
    }
export type UsageObject = {
  args?: string[] | Partial<Record<string, true>> | undefined
  options?: string[] | Partial<Record<string, true>> | undefined
  prefix?: string | undefined
  suffix?: string | undefined
}
export type Usage = string | UsageObject

export type BuiltinsConfig = {
  completions?: boolean | undefined
  config?: boolean | undefined
  mcp?: boolean | undefined
  skills?: boolean | undefined
}

export type SkillDefinition = {
  index?: string | undefined
  markdown?: string | undefined
}

export type CommandDefinition<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  agent?: boolean | undefined
  alias?: Record<string, string> | undefined
  aliases?: string[] | undefined
  args?: A | undefined
  auth?: CommandAuthMetadata | undefined
  basePath?: string | undefined
  description?: string | undefined
  env?: E | undefined
  effects?: CommandEffects | undefined
  examples?: Example[] | undefined
  fetch?: FetchHandler | undefined
  hint?: string | undefined
  middleware?: MiddlewareHandler[] | undefined
  options?: O | undefined
  optionEnv?: Record<string, string> | undefined
  optionConfig?: Record<string, string> | undefined
  output?: Out | undefined
  outputPolicy?: OutputPolicy | undefined
  policy?: CommandPolicy | undefined
  safety?: CommandSafety | undefined
  run?:
    | ((context: RunContext<InferSchema<A>, InferSchema<O>, InferSchema<E>, Record<string, unknown>>) =>
        | unknown
        | AsyncGenerator<unknown, unknown, unknown>
        | Promise<unknown | AsyncGenerator<unknown, unknown, unknown> | void>
        | void)
    | undefined
  summary?: string | undefined
  usage?: Usage[] | undefined
}

export type CommandInput<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  aliases?: Record<string, string> | undefined
  args?: A | undefined
  config?: Record<string, string> | undefined
  env?: E | undefined
  options?: O | undefined
}

export type DeclarativeCommandRunContext<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  ctx: RunContext<InferSchema<A>, InferSchema<O>, InferSchema<E>, Record<string, unknown>>
  input: {
    args: InferSchema<A>
    config: Record<string, unknown>
    env: InferSchema<E>
    options: InferSchema<O>
  }
}

export type DeclarativeCommand<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = Omit<CommandDefinition<A, E, O, Out>, 'alias' | 'aliases' | 'args' | 'env' | 'optionConfig' | 'options' | 'run'> & {
  aliases?: readonly (readonly string[])[] | undefined
  input?: CommandInput<A, E, O> | undefined
  path: readonly [string, ...string[]]
  run?:
    | ((context: DeclarativeCommandRunContext<A, E, O>) =>
        | unknown
        | AsyncGenerator<unknown, unknown, unknown>
        | Promise<unknown | AsyncGenerator<unknown, unknown, unknown> | void>
        | void)
    | undefined
  summary?: string | undefined
}

export type DefineCliOptions = Omit<CreateOptions, 'name'> & {
  commands?: readonly DeclarativeCommand[] | undefined
  name: string
}

export type CreateOptions<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = CommandDefinition<A, E, O, Out> & {
  builtins?: BuiltinsConfig | undefined
  config?: ConfigDefinition | undefined
  format?: Format | undefined
  generated?:
    | {
        machineOutput: 'envelope'
        disabledGlobals?: readonly DisabledGlobal[] | undefined
      }
    | undefined
  events?: readonly CliEventRegistration[] | undefined
  hooks?: CliHookRegistration | undefined
  mcp?: { agents?: string[] | undefined; command?: string | undefined } | undefined
  skill?: SkillDefinition | undefined
  name?: string | undefined
  sync?:
    | {
        cwd?: string | undefined
        depth?: number | undefined
        include?: string[] | undefined
        suggestions?: string[] | undefined
      }
    | undefined
  vars?: Schema<any> | undefined
  version?: string | undefined
}

export type GroupEntry = {
  _group: true
  commands: Map<string, Entry>
  contract: CommandContract
  description?: string | undefined
  events: CliEventSubscription[]
  hooks: CliHooks
  middlewares: MiddlewareHandler[]
  name: string
  outputPolicy?: OutputPolicy | undefined
  root?: RuntimeEntry | undefined
}

export type CommandRuntime = {
  alias?: Record<string, string> | undefined
  args?: Schema<any> | undefined
  env?: Schema<any> | undefined
  middleware?: MiddlewareHandler[] | undefined
  optionConfig?: Record<string, string> | undefined
  optionEnv?: Record<string, string> | undefined
  options?: Schema<any> | undefined
  output?: Schema<any> | undefined
  run?: CommandDefinition['run'] | undefined
}

export type CommandEntry = {
  _command: true
  contract: CommandContract
  runtime: CommandRuntime
}

export type FetchEntry = {
  _fetch: true
  basePath?: string | undefined
  contract: CommandContract
  fetch: FetchHandler
}

export type AliasEntry = { _alias: true; target: string }
export type RuntimeEntry = CommandEntry | FetchEntry
export type Entry = RuntimeEntry | GroupEntry | AliasEntry

export type CliState = {
  commands: Map<string, Entry>
  def: CreateOptions
  events: CliEventSubscription[]
  hooks: CliHooks
  middlewares: MiddlewareHandler[]
  root?: RuntimeEntry | undefined
}

export type ServeOptions = {
  env?: Record<string, string | undefined> | undefined
  exit?: ((code: number) => void) | undefined
  isTty?: boolean | undefined
  stderr?: ((s: string) => void) | undefined
  stdin?: AsyncIterable<string | Uint8Array> | ReadableStream<Uint8Array> | undefined
  stdout?: ((s: string) => void) | undefined
}

export type CliInstance = {
  description?: string | undefined
  env?: Schema<any> | undefined
  fetch(request: Request): Promise<Response>
  hook<T extends CliHookType>(type: T, handler: CliHookHandler<T>): CliInstance
  name: string
  on(target: CliEventTarget, subscriber: CliEventSubscriber): CliInstance
  serve(argv?: string[], options?: ServeOptions): Promise<void>
  use(handler: MiddlewareHandler): CliInstance
  vars?: Schema<any> | undefined
}

export type SelectedCommand = {
  argv: { args: string[]; options?: Record<string, unknown> | undefined }
  entry: Entry
  events: CliEventSubscription[]
  hooks: CliHooks
  middlewares: MiddlewareHandler[]
  path: string[]
  rootDef?: CreateOptions | undefined
}

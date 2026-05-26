import type { z } from "zod";

export type Dict<T = unknown> = Record<string, T>;
export type Awaitable<T> = T | Promise<T>;
export type BuiltInFormat = "json" | "yaml" | "md" | "jsonl" | "csv";
export type Format = BuiltInFormat | (string & {});
export type OutputPolicy = "all" | "machine-only";
export type GlobalInputType = "boolean" | "string";
export type GlobalInputDefinition = {
  alias?: string | undefined;
  default?: boolean | string | undefined;
  deprecated?: boolean | string | undefined;
  description?: string | undefined;
  expose?: "context" | "runtime" | undefined;
  flag?: string | undefined;
  hidden?: boolean | undefined;
  key: string;
  parse?:
    | ((value: string, flag: string) => boolean | number | string)
    | undefined;
  type: GlobalInputType;
  valueLabel?: string | undefined;
};
export type NormalizedGlobalInputDefinition = Omit<
  GlobalInputDefinition,
  "expose" | "flag"
> & {
  expose: "context" | "runtime";
  flag: string;
};
export type GlobalOptions = Record<string, boolean | string | undefined> & {
  nonInteractive?: boolean | undefined;
  noSession?: boolean | undefined;
  profile?: string | undefined;
};
export type Schema<T = unknown> = z.ZodType<T>;
export type InferSchema<T> = T extends z.ZodType<infer O> ? O : unknown;

export type InputSourceBinding = {
  path: string;
  provider: string;
};

export type InputSourceProvenance = Record<string, unknown> & {
  kind: string;
};

export type OptionValueSource =
  | { kind: "argv" }
  | {
      kind: "provider";
      path: string;
      provider: string;
      source: InputSourceProvenance;
    }
  | { kind: "default" };

export type ResolvedInputSource = {
  get(path: string): unknown;
  source(path: string): InputSourceProvenance;
};

export type InputSourceResolveInput = {
  commandPath: readonly string[];
  env: Dict<string | undefined>;
  flags: Dict;
};

export type InputSourceProvider = {
  id: string;
  resolve(input: InputSourceResolveInput): Awaitable<ResolvedInputSource>;
};

export type SourceInspector = {
  option(name: string): OptionValueSource;
  source(provider: string, path: string): InputSourceProvenance;
  value(provider: string, path: string): unknown;
};

export type Cta =
  | string
  | {
      args?: Record<string, unknown> | undefined;
      command: string;
      description?: string | undefined;
      options?: Record<string, unknown> | undefined;
    };

export type CtaBlock = {
  commands?: Cta[] | undefined;
  description?: string | undefined;
};

export type FieldError = {
  path: string;
  message: string;
  code?: string | undefined;
  missing?: boolean | undefined;
  expected?: string | undefined;
  received?: string | undefined;
};

export type CommandError = {
  code: string;
  code_actions?:
    | Array<{
        argv?: readonly string[] | undefined;
        command?: string | undefined;
        description?: string | undefined;
        title: string;
      }>
    | undefined;
  detail?: string | undefined;
  details?: Record<string, unknown> | undefined;
  exitCode?: number | undefined;
  fieldErrors?: FieldError[] | undefined;
  hint?: string | undefined;
  instance?: string | undefined;
  message: string;
  retry_after?: number | string | undefined;
  retryable?: boolean | undefined;
  suggested_fix?: string | undefined;
  status?: number | undefined;
  title?: string | undefined;
  type?: string | undefined;
};

export type ResultMeta = Record<string, unknown> & {
  cta?: CtaBlock | undefined;
};

export type Result =
  | { ok: true; data: unknown; error: null; meta?: ResultMeta | undefined }
  | {
      ok: false;
      data: null;
      error: CommandError;
      meta?: ResultMeta | undefined;
    };

export type CommandContract = {
  aliases?: readonly string[] | undefined;
  auth?: CommandAuthMetadata | undefined;
  description?: string | undefined;
  effects?: CommandEffects | undefined;
  examples?: readonly Example[] | undefined;
  format?: Format | undefined;
  hint?: string | undefined;
  interactive?: boolean | undefined;
  name: string;
  outputPolicy?: OutputPolicy | undefined;
  path?: readonly string[] | undefined;
  policy?: CommandPolicy | undefined;
  safety?: CommandSafety | undefined;
  schema?: unknown;
  summary?: string | undefined;
  usage?: readonly Usage[] | undefined;
};

export type CommandEffectKind =
  | "read"
  | "write"
  | "delete"
  | "exec"
  | "auth-session"
  | "auth-session-read"
  | "auth-session-write"
  | "auth-session-delete"
  | "auth-context-write";

export type CommandEffects = {
  kind: CommandEffectKind;
  idempotent?: boolean | undefined;
};

export type CommandPolicy = {
  conformanceEligible?: boolean | undefined;
  dangerous?: boolean | undefined;
  requiresConfirmation?: boolean | undefined;
};

export type CommandSafety = {
  auth?: "none" | "optional" | "required" | undefined;
  destructive?: boolean | undefined;
  idempotent?: boolean | undefined;
  interactive?: "never" | "optional" | "required" | undefined;
  openWorld?: boolean | undefined;
  readOnly?: boolean | undefined;
};

export type CommandAuthMetadata = {
  required: boolean;
  status: "not-required" | "requires-runtime-resolution";
  providerId?: string | undefined;
  envVars?: readonly string[] | undefined;
  contexts?:
    | readonly {
        id: string;
        envVar?: string | undefined;
        flag?: string | undefined;
      }[]
    | undefined;
  requiredPermissions?: readonly string[] | undefined;
  requiredScopes?: readonly string[] | undefined;
};

export type CommandManifest = {
  commands: CommandContract[];
  description?: string | undefined;
  name: string;
  version?: string | undefined;
};

export type RunContext<
  A = Record<string, unknown>,
  O = Record<string, unknown>,
  E = Record<string, unknown>,
  V = Record<string, unknown>,
> = {
  args: A;
  displayName: string;
  env: E;
  error(
    input: CommandError & {
      cta?: CtaBlock | undefined;
    },
  ): Result;
  format: Format;
  formatExplicit: boolean;
  global: GlobalOptions;
  isTty: boolean;
  name: string;
  ok(data?: unknown, meta?: ResultMeta): Result;
  options: O;
  set(key: string, value: unknown): void;
  sources: SourceInspector;
  var: V;
};

export type MiddlewareContext = RunContext;
export type MiddlewareHandler = (
  context: MiddlewareContext,
  next: () => Promise<void>,
) => Awaitable<unknown>;

export type CliEventType =
  | "command.selected"
  | "command.started"
  | "command.completed"
  | "command.failed"
  | "validation.failed"
  | "parse.failed"
  | "command.not_found"
  | "help.rendered"
  | "version.rendered"
  | "completion.generated"
  | "schema.generated"
  | "hook.failed"
  | (string & {});
export type CliEventTarget = CliEventType | "*";
export type CliEventCommand = {
  id: string;
  path: readonly string[];
};
export type CliEventCompletion = {
  shell?: string | undefined;
  suggestionCount?: number | undefined;
};
export type CliEventError = {
  code: string;
  exitCode?: number | undefined;
  fieldErrorCount?: number | undefined;
  retryable?: boolean | undefined;
  status?: number | undefined;
};
export type CliEventSurface = {
  kind: "command" | "completion" | "help" | "parse" | "schema" | "version";
  name?: string | undefined;
};
export type CliEvent = {
  attributes?: Record<string, unknown> | undefined;
  cli: {
    name: string;
    version?: string | undefined;
  };
  command?: CliEventCommand | undefined;
  completion?: CliEventCompletion | undefined;
  durationMs?: number | undefined;
  error?: CliEventError | undefined;
  exitCode?: number | undefined;
  format: Format;
  formatExplicit: boolean;
  isTty: boolean;
  occurredAt: string;
  result?: "success" | "user_error" | "system_error" | "canceled" | undefined;
  surface?: CliEventSurface | undefined;
  type: CliEventType;
};
export type CliEventSubscriber = (event: Readonly<CliEvent>) => Awaitable<void>;
export type CliEventRegistration =
  | CliEventSubscriber
  | {
      subscriber: CliEventSubscriber;
      target: CliEventTarget;
    };
export type CliEventSubscription = {
  subscriber: CliEventSubscriber;
  target: CliEventTarget;
};

export type BeforeExecuteHook = (
  context: MiddlewareContext,
) => Awaitable<void | Result>;

export type PrepareContextInput = {
  name: string;
  env: Dict<string | undefined>;
  flags: Dict;
};
export type PrepareContextResult =
  | void
  | Result
  | { patch: Partial<RunContext> };
export type PrepareContextHook = (
  input: PrepareContextInput,
) => Awaitable<PrepareContextResult>;

export type CliHookRegistration = {
  beforeExecute?: BeforeExecuteHook | readonly BeforeExecuteHook[] | undefined;
  prepareContext?:
    | PrepareContextHook
    | readonly PrepareContextHook[]
    | undefined;
};
export type CliHooks = {
  beforeExecute: BeforeExecuteHook[];
  prepareContext: PrepareContextHook[];
};

export type FetchHandler = (request: Request) => Awaitable<Response>;
export type Example =
  | string
  | {
      args?: Record<string, unknown>;
      command?: string;
      description?: string;
      options?: Record<string, unknown>;
    };
export type UsageObject = {
  args?: string[] | Partial<Record<string, true>> | undefined;
  options?: string[] | Partial<Record<string, true>> | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
};
export type Usage = string | UsageObject;

export type HelpField = {
  defaultValue?: string | undefined;
  deprecated?: boolean | string | undefined;
  description?: string | undefined;
  env?: string | undefined;
  label: string;
  name: string;
  required: boolean;
  usage: string;
};

export type HelpCommand = {
  aliases: readonly string[];
  description?: string | undefined;
  name: string;
};

export type HelpGlobal = {
  alias?: string | undefined;
  defaultValue?: string | undefined;
  deprecated?: boolean | string | undefined;
  description?: string | undefined;
  flag: string;
  key: string;
  label: string;
};

export type HelpModel = {
  aliases: readonly string[];
  args: readonly HelpField[];
  commands: readonly HelpCommand[];
  description?: string | undefined;
  examples: readonly Example[];
  globals: readonly HelpGlobal[];
  hint?: string | undefined;
  name: string;
  options: readonly HelpField[];
  path: readonly string[];
  usage: readonly string[];
};

export type HelpRenderContext = {
  binaryName: string;
  path: readonly string[];
};

export type HelpRenderer = (
  model: HelpModel,
  context: HelpRenderContext,
) => string;

export type OutputRenderStage = "schema" | "chunk" | "result";

export type OutputRenderContext = {
  format: Format;
  stage: OutputRenderStage;
};

export type OutputRenderer = {
  mediaType?: string | undefined;
  name: Format;
  render(value: unknown, context: OutputRenderContext): string;
};

export type SkillDefinition = {
  index?: string | undefined;
  markdown?: string | undefined;
};

export type CommandDefinition<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  alias?: Record<string, string> | undefined;
  aliases?: string[] | undefined;
  args?: A | undefined;
  auth?: CommandAuthMetadata | undefined;
  basePath?: string | undefined;
  description?: string | undefined;
  env?: E | undefined;
  effects?: CommandEffects | undefined;
  examples?: Example[] | undefined;
  fetch?: FetchHandler | undefined;
  format?: Format | undefined;
  formats?: Partial<Record<Format, OutputRenderer["render"]>> | undefined;
  hint?: string | undefined;
  interactive?: boolean | undefined;
  middleware?: MiddlewareHandler[] | undefined;
  options?: O | undefined;
  output?: Out | undefined;
  outputPolicy?: OutputPolicy | undefined;
  policy?: CommandPolicy | undefined;
  safety?: CommandSafety | undefined;
  sources?:
    | {
        options?: Record<string, readonly InputSourceBinding[]> | undefined;
      }
    | undefined;
  run?:
    | ((
        context: RunContext<
          InferSchema<A>,
          InferSchema<O>,
          InferSchema<E>,
          Record<string, unknown>
        >,
      ) =>
        | unknown
        | AsyncGenerator<unknown, unknown, unknown>
        | Promise<unknown | AsyncGenerator<unknown, unknown, unknown> | void>
        | void)
    | undefined;
  summary?: string | undefined;
  usage?: Usage[] | undefined;
};

export type CommandInput<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  aliases?: Record<string, string> | undefined;
  args?: A | undefined;
  env?: E | undefined;
  options?: O | undefined;
  sources?:
    | {
        options?: Record<string, readonly InputSourceBinding[]> | undefined;
      }
    | undefined;
};

export type DeclarativeCommandRunContext<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  ctx: RunContext<
    InferSchema<A>,
    InferSchema<O>,
    InferSchema<E>,
    Record<string, unknown>
  >;
  input: {
    args: InferSchema<A>;
    env: InferSchema<E>;
    options: InferSchema<O>;
  };
};

export type DeclarativeCommand<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = Omit<
  CommandDefinition<A, E, O, Out>,
  "alias" | "aliases" | "args" | "env" | "options" | "run"
> & {
  aliases?: readonly (string | readonly string[])[] | undefined;
  input?: CommandInput<A, E, O> | undefined;
  path: readonly [string, ...string[]];
  run?:
    | ((
        context: DeclarativeCommandRunContext<A, E, O>,
      ) =>
        | unknown
        | AsyncGenerator<unknown, unknown, unknown>
        | Promise<unknown | AsyncGenerator<unknown, unknown, unknown> | void>
        | void)
    | undefined;
  summary?: string | undefined;
};

export type CliExtension = {
  commands?: readonly DeclarativeCommand[] | undefined;
  events?: readonly CliEventRegistration[] | undefined;
  fetchRoutes?: readonly FetchRoute[] | undefined;
  globals?: readonly GlobalInputDefinition[] | undefined;
  helpRenderer?: HelpRenderer | undefined;
  hooks?: CliHookRegistration | undefined;
  id: string;
  inputSources?: readonly InputSourceProvider[] | undefined;
  middleware?: readonly MiddlewareHandler[] | undefined;
  outputRenderers?: readonly OutputRenderer[] | undefined;
  outputTransforms?: readonly OutputTransform[] | undefined;
  serveHandlers?: readonly ServeHandler[] | undefined;
  skill?: SkillDefinition | undefined;
};

export type ServeHandlerInput = {
  binaryName: string;
  flags: GlobalFlags;
  options: ServeOptions;
  state: CliState;
};

export type ServeHandler = {
  flagKey: string;
  handle: (input: ServeHandlerInput) => Promise<void> | void;
};

export type OutputTransformInput = {
  flags: GlobalFlags;
  format: Format;
  stage: "result";
};

export type OutputTransform = {
  id: string;
  bufferingFlagKeys?: readonly string[] | undefined;
  transform: (text: string, input: OutputTransformInput) => string;
};

export type FetchRouteInput = {
  binaryName: string;
  request: Request;
  state: CliState;
  url: URL;
};

export type FetchRoute = {
  match: (url: URL) => boolean;
  handle: (input: FetchRouteInput) => Promise<Response>;
};

export type GlobalFlags = {
  [key: string]: unknown;
  filterOutput?: string | undefined;
  format?: Format | undefined;
  formatExplicit?: boolean | undefined;
  fullOutput?: boolean | undefined;
  help?: boolean | undefined;
  json?: boolean | undefined;
  llms?: boolean | undefined;
  noSession?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  profile?: string | undefined;
  rest: string[];
  schema?: boolean | undefined;
  version?: boolean | undefined;
};

export type DefineCliOptions = Omit<CreateOptions, "name"> & {
  commands?: readonly DeclarativeCommand[] | undefined;
  extensions?: readonly CliExtension[] | undefined;
  name: string;
};

export type CreateOptions<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = CommandDefinition<A, E, O, Out> & {
  format?: Format | undefined;
  generated?:
    | {
        machineOutput: "envelope";
      }
    | undefined;
  events?: readonly CliEventRegistration[] | undefined;
  fetchRoutes?: readonly FetchRoute[] | undefined;
  helpRenderer?: HelpRenderer | undefined;
  hooks?: CliHookRegistration | undefined;
  globals?: readonly GlobalInputDefinition[] | undefined;
  inputSources?: readonly InputSourceProvider[] | undefined;
  outputRenderers?: readonly OutputRenderer[] | undefined;
  outputTransforms?: readonly OutputTransform[] | undefined;
  serveHandlers?: readonly ServeHandler[] | undefined;
  skill?: SkillDefinition | undefined;
  name?: string | undefined;
  sync?:
    | {
        cwd?: string | undefined;
        depth?: number | undefined;
        include?: string[] | undefined;
        suggestions?: string[] | undefined;
      }
    | undefined;
  vars?: Schema<any> | undefined;
  version?: string | undefined;
};

export type GroupEntry = {
  _group: true;
  commands: Map<string, Entry>;
  contract: CommandContract;
  description?: string | undefined;
  events: CliEventSubscription[];
  hooks: CliHooks;
  middlewares: MiddlewareHandler[];
  name: string;
  outputPolicy?: OutputPolicy | undefined;
  root?: RuntimeEntry | undefined;
};

export type CommandRuntime = {
  alias?: Record<string, string> | undefined;
  args?: Schema<any> | undefined;
  env?: Schema<any> | undefined;
  formats?: Partial<Record<Format, OutputRenderer["render"]>> | undefined;
  middleware?: MiddlewareHandler[] | undefined;
  options?: Schema<any> | undefined;
  output?: Schema<any> | undefined;
  run?: CommandDefinition["run"] | undefined;
  sources?:
    | {
        options?: Record<string, readonly InputSourceBinding[]> | undefined;
      }
    | undefined;
};

export type CommandEntry = {
  _command: true;
  contract: CommandContract;
  runtime: CommandRuntime;
};

export type FetchEntry = {
  _fetch: true;
  basePath?: string | undefined;
  contract: CommandContract;
  fetch: FetchHandler;
};

export type AliasEntry = { _alias: true; target: string };
export type RuntimeEntry = CommandEntry | FetchEntry;
export type Entry = RuntimeEntry | GroupEntry | AliasEntry;

export type CliState = {
  commands: Map<string, Entry>;
  def: CreateOptions;
  events: CliEventSubscription[];
  fetchRoutes: readonly FetchRoute[];
  globals: readonly NormalizedGlobalInputDefinition[];
  helpRenderer?: HelpRenderer | undefined;
  hooks: CliHooks;
  inputSources: readonly InputSourceProvider[];
  middlewares: MiddlewareHandler[];
  outputRenderers: readonly OutputRenderer[];
  outputTransforms: readonly OutputTransform[];
  root?: RuntimeEntry | undefined;
  serveHandlers: readonly ServeHandler[];
};

export type ServeOptions = {
  env?: Record<string, string | undefined> | undefined;
  exit?: ((code: number) => void) | undefined;
  isTty?: boolean | undefined;
  stderr?: ((s: string) => void) | undefined;
  stdin?:
    | AsyncIterable<string | Uint8Array>
    | ReadableStream<Uint8Array>
    | undefined;
  stdout?: ((s: string) => void) | undefined;
};

export type CliInstance = {
  description?: string | undefined;
  env?: Schema<any> | undefined;
  fetch(request: Request): Promise<Response>;
  name: string;
  serve(argv?: string[], options?: ServeOptions): Promise<void>;
  vars?: Schema<any> | undefined;
};

export type SelectedCommand = {
  argv: { args: string[]; options?: Record<string, unknown> | undefined };
  entry: Entry;
  events: CliEventSubscription[];
  hooks: CliHooks;
  middlewares: MiddlewareHandler[];
  path: string[];
  rootDef?: CreateOptions | undefined;
};

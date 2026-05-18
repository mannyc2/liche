import type { z } from 'zod'

export type Dict<T = unknown> = Record<string, T>
export type Awaitable<T> = T | Promise<T>
export type Format = 'toon' | 'json' | 'yaml' | 'md' | 'jsonl'
export type DisabledGlobal = 'format'
export type OutputPolicy = 'all' | 'agent-only'
export type Schema<T = unknown> = z.ZodType<T>
export type InferSchema<T> = T extends z.ZodType<infer O> ? O : unknown

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

export type CommandManifestEntry = {
  aliases?: readonly string[] | undefined
  description?: string | undefined
  entry?: Entry | undefined
  examples?: readonly Example[] | undefined
  hint?: string | undefined
  name: string
  outputPolicy?: OutputPolicy | undefined
  schema?: unknown
  usage?: readonly Usage[] | undefined
}

export type CommandManifest = {
  commands: CommandManifestEntry[]
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
  name: string
  ok(data?: unknown, meta?: ResultMeta): never
  options: O
  set(key: string, value: unknown): void
  var: V
}

export type MiddlewareContext = RunContext & { result?: Result | undefined }
export type MiddlewareHandler = (
  context: MiddlewareContext,
  next: () => Promise<void>,
) => Awaitable<void | Result | unknown>

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

export type CommandDefinition<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  alias?: Record<string, string> | undefined
  aliases?: string[] | undefined
  args?: A | undefined
  basePath?: string | undefined
  description?: string | undefined
  env?: E | undefined
  examples?: Example[] | undefined
  fetch?: FetchHandler | undefined
  hint?: string | undefined
  middleware?: MiddlewareHandler[] | undefined
  options?: O | undefined
  optionEnv?: Record<string, string> | undefined
  output?: Out | undefined
  outputPolicy?: OutputPolicy | undefined
  run?:
    | ((context: RunContext<InferSchema<A>, InferSchema<O>, InferSchema<E>, Record<string, unknown>>) =>
        | unknown
        | AsyncGenerator<unknown, unknown, unknown>
        | Promise<unknown | AsyncGenerator<unknown, unknown, unknown> | void>
        | void)
    | undefined
  usage?: Usage[] | undefined
}

export type CreateOptions<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = CommandDefinition<A, E, O, Out> & {
  config?:
    | {
        files?: string[] | undefined
        flag?: string | undefined
        loader?: ((path: string | undefined) => Awaitable<Record<string, unknown> | undefined>) | undefined
      }
    | undefined
  format?: Format | undefined
  generated?:
    | {
        machineOutput: 'envelope'
        disabledGlobals?: readonly DisabledGlobal[] | undefined
      }
    | undefined
  mcp?: { agents?: string[] | undefined; command?: string | undefined } | undefined
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
  description?: string | undefined
  middlewares: MiddlewareHandler[]
  name: string
  outputPolicy?: OutputPolicy | undefined
  root?: CommandDefinition | undefined
}

export type FetchEntry = {
  _fetch: true
  basePath?: string | undefined
  description?: string | undefined
  fetch: FetchHandler
  outputPolicy?: OutputPolicy | undefined
}

export type AliasEntry = { _alias: true; target: string }
export type Entry = CommandDefinition | GroupEntry | FetchEntry | AliasEntry

export type CliState = {
  commands: Map<string, Entry>
  def: CreateOptions
  middlewares: MiddlewareHandler[]
  root?: CommandDefinition | undefined
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
  command<
    A extends Schema<any> | undefined = undefined,
    E extends Schema<any> | undefined = undefined,
    O extends Schema<any> | undefined = undefined,
    Out extends Schema<any> | undefined = undefined,
  >(
    name: string,
    definition: CommandDefinition<A, E, O, Out>,
  ): CliInstance
  command(cli: CliInstance): CliInstance
  description?: string | undefined
  env?: Schema<any> | undefined
  fetch(request: Request): Promise<Response>
  name: string
  serve(argv?: string[], options?: ServeOptions): Promise<void>
  use(handler: MiddlewareHandler): CliInstance
  vars?: Schema<any> | undefined
}

export type SelectedCommand = {
  argv: { args: string[]; options?: Record<string, unknown> | undefined }
  entry: Entry
  middlewares: MiddlewareHandler[]
  path: string[]
  rootDef?: CreateOptions | undefined
}

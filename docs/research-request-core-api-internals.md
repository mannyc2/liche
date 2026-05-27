# Standalone research prompt: improve `@liche/core`

You are researching how to improve the API and internals of `@liche/core`, a Bun-native TypeScript CLI runtime, before a public API freeze. You will not have access to the codebase. Treat the snapshot below as the current state of the system and produce a hard-cutover recommendation. Do not propose compatibility shims unless you can prove they are needed before `1.0.0`.

## Output Expected From You

Return a concise but evidence-backed research report with these sections:

```txt
Executive summary
Top findings ranked by impact
Recommended public API surface
Recommended internal architecture
State and type inventory
Benchmark design and scoring rubric
Reviewable implementation sequence
Open questions
Appendix: external evidence and assumptions
```

Every recommendation must name the current API, type, behavior, or module concept it changes, explain why, and describe the verification that would prove the change.
The state and type inventory must explicitly classify each current state/type family as public-stable, public-unstable, extension-only, projection-only, or private.

## Fixed Constraints

- Runtime and implementation language: TypeScript on Bun.
- Package state: pre-`1.0.0`; hard cutovers are acceptable.
- Primary research scope: `@liche/core`.
- Secondary scope: optional first-party packages only when they reveal a core API weakness.
- Out of scope: redesigning Product generation, Build, Releases, hosted services, dashboards, package-manager publishing, or generated website/docs strategy.
- Public API goal: small, stable, statically analyzable, and easy for humans, scripts, and agents to use correctly.
- Distribution assumption: source-published Bun package is acceptable unless research proves it blocks real consumers.

## Product Suite State

The broader package suite is synchronized at `0.5.x` and currently consists of:

| Package | Required | Current purpose |
|---|---:|---|
| `@liche/core` | yes | Bun-native CLI runtime for handwritten and generated CLIs. |
| `@liche/extensions` | no | Umbrella re-export for official optional extension packages. |
| `@liche/config` | no | Config file discovery/loading plus config globals and diagnostics over Core input-source lanes. |
| `@liche/auth` | no | Auth/session workflows, token resolution, session store, OAuth/device helpers. |
| `@liche/completions` | no | Shell completion command helpers. |
| `@liche/mcp-server` | no | MCP stdio/HTTP server adapters over core command contracts and execution. |
| `@liche/mcp-installer` | no | MCP client config installer commands. |
| `@liche/skills-runtime` | no | Agent skill markdown/index generation from command contracts. |
| `@liche/skills-installer` | no | Agent skill installer commands. |
| `@liche/agents` | no | Bundle for MCP/skills/LLM-facing helper surfaces. |
| `@liche/telemetry` | no | Local telemetry sink adapters over lifecycle events. |
| `@liche/tokens` | no | Token-aware output controls. |
| `@liche/product` | no | Product catalog authoring and generated surfaces. |
| `@liche/build` | no | Bun compile/build wrapper and compile provenance. |
| `@liche/releases` | no | Release manifests, package renderers, publish planning/execution. |

`@liche/core` must not depend on Product, Build, Releases, or optional extensions. Optional packages may depend on `@liche/core` through public package-root imports.

## Core Package State

`@liche/core@0.5.0` is currently a Bun-only TypeScript source package. It exports only the package root. The root export surface is broad:

```txt
Formatter
ParseError
ValidationError
applyAuth
callHttpOperation
collectCommandContracts
commandError
createLifecycleEvent
defaultHelpRenderer
defineCli
defineCommand
defineExtension
defineGlobal
defineOutputRenderer
emitLifecycleEvent
eventCommand
execute
fail
getCliState
help
manifest
manifestEnvelope
mcpToolName
mergeHooks
middleware
ok
outputControls
parseSchema
reflectionControls
secret
selectCommand
serializeHttpOperationRequest
version
z
```

The intended public authoring path is data-first:

```ts
import {
  defineCli,
  defineCommand,
  help,
  outputControls,
  version,
  z,
} from "@liche/core";

export const cli = defineCli({
  name: "shipyard",
  version: "0.1.0",
  extensions: [
    help(),
    version(),
    outputControls({ json: true, fullOutput: true }),
  ],
  commands: [
    defineCommand({
      path: ["deploy"],
      summary: "Deploy a service",
      input: {
        options: z.object({
          entrypoint: z.string(),
          dryRun: z.boolean().default(false),
        }),
      },
      output: z.object({
        deploymentId: z.string(),
      }),
      safety: {
        auth: "required",
        destructive: false,
        idempotent: false,
        interactive: "never",
        openWorld: true,
        readOnly: false,
      },
      run({ ctx, input }) {
        if (input.options.dryRun) {
          return ctx.ok(
            { deploymentId: "preview" },
            { cta: { commands: [{ command: "shipyard deploy" }] } },
          );
        }
        return { deploymentId: `dep-${input.options.entrypoint}` };
      },
    }),
  ],
});

if (import.meta.main) await run(cli, Bun.argv.slice(2));
```

## Core Ownership Model

Core currently owns:

- command declaration through `defineCli()` and `defineCommand()`
- typed args/options/env parsing using Zod
- global flag declaration through `defineGlobal()`
- explicit standard controls: `help()`, `version()`, `outputControls()`, `reflectionControls()`
- extension composition through `defineExtension()` and `DefineCliOptions.extensions`
- command selection and registry internals
- command execution, hooks, middleware, lifecycle events, and result normalization
- generic input-source resolution and option provenance
- built-in output renderers for `json`, `jsonl`, `yaml`, and `md`
- custom output renderer registration
- serializable command contracts and manifest helpers
- help model/rendering and default help renderer
- in-process `cli.fetch(request)` command dispatch
- direct MCP execution support over command contracts, though optional MCP servers moved out
- packaged skill metadata, though installers moved out
- auth redaction primitives: `secret()` and `applyAuth()`
- outbound HTTP operation transport: `serializeHttpOperationRequest()` and `callHttpOperation()`

Core should not own:

- config file formats, config discovery, `--config`, or `--no-config`
- auth/session workflows, OAuth, session stores, login/logout/whoami/switch
- shell completion install commands
- MCP or skill installer commands
- telemetry sink implementations
- token counting controls
- Product catalog generation, OpenAPI generation, generated docs, conformance, or generated local ops
- build/compile orchestration
- release manifests, package renderers, or publisher execution

## Core Runtime Architecture and State Model

This is the current architecture in prose. Treat it as authoritative for the research exercise.

### Construction Pipeline

`defineCli(definition)` is the only public constructor. It performs these steps:

1. Rejects removed root fields such as `builtins`.
2. Expands `definition.extensions` into a single root definition.
3. Concatenates extension-contributed arrays with root arrays:
   - commands
   - events
   - middleware
   - globals
   - input sources
   - output renderers
   - output transforms
   - terminal handlers
   - fetch routes
4. Merges extension and root hooks into `beforeExecute` and `prepareContext` arrays.
5. Enforces singleton extension values for `helpRenderer` and `skill`.
6. Creates an internal `CliState`.
7. Registers each declarative command into `state.commands`.
8. Returns a `CliInstance` with only `name`, optional metadata, and `fetch()`.

Important current detail: the returned `CliInstance` is secretly an `InternalCli` carrying a private symbol:

```ts
const stateSymbol: unique symbol = Symbol("liche.cli.state");
type InternalCli = CliInstance & { [stateSymbol]: CliState };
function getCliState(cli: CliInstance): CliState;
```

`getCliState()` is public today. That means the private symbol is hidden but the entire state object is still reachable through the public API.

### Extension Merge Semantics

Current extension merge behavior is deliberately simple data concatenation:

```txt
root.commands + extension.commands -> state command registration input
root.events + extension.events -> state.events
root.middleware + extension.middleware -> state.middlewares
root.globals + extension.globals -> state.globals
root.inputSources + extension.inputSources -> state.inputSources
root.outputRenderers + extension.outputRenderers -> state.outputRenderers
root.outputTransforms + extension.outputTransforms -> state.outputTransforms
root.terminalHandlers + extension.terminalHandlers -> state.terminalHandlers
root.fetchRoutes + extension.fetchRoutes -> state.fetchRoutes
root.hooks + extension.hooks -> state.hooks
```

Singletons:

```txt
helpRenderer: at most one provider across root and extensions
skill: at most one provider across root and extensions
```

There is no extension dependency model, no extension ordering declaration, no duplicate extension-id detection, and no capability negotiation. If research recommends adding any of those, it must name the exact behavior and failure cases.

### Current `CliState`

```ts
type GroupEntry = {
  _group: true;
  commands: Map<string, Entry>;
  contract: CommandContract;
  description?: string;
  events: CliEventSubscription[];
  hooks: CliHooks;
  middlewares: MiddlewareHandler[];
  name: string;
  outputPolicy?: OutputPolicy;
  root?: RuntimeEntry;
};

type CommandRuntime = {
  alias?: Record<string, string>;
  args?: Schema<any>;
  env?: Schema<any>;
  middleware?: MiddlewareHandler[];
  options?: Schema<any>;
  output?: Schema<any>;
  run?: CommandDefinition["run"];
  sources?: {
    options?: Record<string, readonly InputSourceBinding[]>;
  };
};

type CommandEntry = {
  _command: true;
  contract: CommandContract;
  runtime: CommandRuntime;
};

type AliasEntry = {
  _alias: true;
  target: string;
};

type RuntimeEntry = CommandEntry;
type Entry = RuntimeEntry | GroupEntry | AliasEntry;

type CliState = {
  commands: Map<string, Entry>;
  def: CreateOptions;
  events: CliEventSubscription[];
  fetchRoutes: readonly FetchRoute[];
  globals: readonly NormalizedGlobalInputDefinition[];
  helpRenderer?: HelpRenderer;
  hooks: CliHooks;
  inputSources: readonly InputSourceProvider[];
  middlewares: MiddlewareHandler[];
  outputRenderers: readonly OutputRenderer[];
  outputTransforms: readonly OutputTransform[];
  root?: RuntimeEntry;
  terminalHandlers: readonly TerminalHandler[];
};
```

Field meaning:

| Field | Meaning | Public-leak concern |
|---|---|---|
| `commands` | Top-level command graph. Values are `Entry` variants. | Exposes mutable `Map` and internal registry shape. |
| `def` | The expanded root `CreateOptions`, including root command metadata and package metadata. | Exposes root authoring object and generated-mode flag. |
| `events` | Normalized observe-only lifecycle subscribers. | Exposes event routing internals. |
| `fetchRoutes` | Extension/root HTTP route interceptors before command dispatch. | Exposes raw state to route handlers. |
| `globals` | Normalized global flag definitions. | Exposes parser registry and hidden/runtime/context controls. |
| `helpRenderer` | Optional custom renderer for help and validation help. | Probably public as a concept, not necessarily state. |
| `hooks` | Normalized `beforeExecute` and `prepareContext` hooks. | Exposes hook ordering. |
| `inputSources` | Input providers used before schema defaults. | Public concept, but raw list mutability is unclear. |
| `middlewares` | Root middleware stack. | Public concept, but execution internals leak. |
| `outputRenderers` | Built-in plus custom renderer registry. | Public concept, but registry shape is raw array. |
| `outputTransforms` | Final text transforms after rendering. | Possibly too low-level for stable API. |
| `root` | Optional root command/fetch runtime entry. | Internal command graph detail. |
| `terminalHandlers` | Flag-triggered side-effect handlers such as extension surfaces. | Strong internal/adapter smell. |

Current state is not deeply frozen. Some arrays are copied, output renderer registry is frozen, command maps are mutable, and command entries contain handler functions. Research should explicitly decide whether public consumers should ever see this object.

### Command Graph State

The runtime command graph is a nested map of `Entry` values:

```ts
type Entry = RuntimeEntry | GroupEntry | AliasEntry;
type RuntimeEntry = CommandEntry;

type CommandEntry = {
  _command: true;
  contract: CommandContract;
  runtime: CommandRuntime;
};

type GroupEntry = {
  _group: true;
  name: string;
  commands: Map<string, Entry>;
  contract: CommandContract;
  description?: string;
  outputPolicy?: OutputPolicy;
  root?: RuntimeEntry;
  events: CliEventSubscription[];
  hooks: CliHooks;
  middlewares: MiddlewareHandler[];
};

type AliasEntry = {
  _alias: true;
  target: string;
};
```

Current registration behavior:

- `defineCommand({ path: ["a", "b"] })` creates or reuses a group `a`, then registers leaf `b`.
- If a leaf already exists and later becomes a parent group, the existing command can become the group's `root`.
- Groups can have a root command and child commands.
- Aliases must share the same parent path as the target command.
- Alias entries store only a sibling target string, not a full path.
- Command entries contain both serializable `contract` and executable `runtime`.
- Fetch entries are an older in-process request/response bridge and do not use `run`.

Research question: should the public model distinguish serializable graph data from executable graph data more clearly?

### Command Runtime State

`CommandRuntime` is the executable half of a command:

```ts
type CommandRuntime = {
  alias?: Record<string, string>;
  args?: Schema<any>;
  env?: Schema<any>;
  middleware?: MiddlewareHandler[];
  options?: Schema<any>;
  output?: Schema<any>;
  run?: CommandDefinition["run"];
  sources?: {
    options?: Record<string, readonly InputSourceBinding[]>;
  };
};
```

`CommandContract` is the serializable half:

```ts
type CommandContract = {
  name: string;
  path?: readonly string[];
  aliases?: readonly string[];
  summary?: string;
  description?: string;
  hint?: string;
  usage?: readonly Usage[];
  examples?: readonly Example[];
  schema?: unknown;
  format?: Format;
  outputPolicy?: OutputPolicy;
  agent?: boolean;
  auth?: CommandAuthMetadata;
  effects?: CommandEffects;
  policy?: CommandPolicy;
  safety?: CommandSafety;
};
```

Current projection behavior:

- `commandContractFromDefinition()` builds the contract during registration.
- `commandSchema(definition)` builds reflection schema from args/options/env/output.
- `groupContract()` creates metadata for group nodes.
- `commandContract(name, entry, aliases)` rebases a stored contract to a selected path/name.
- `collectCommandContracts(commands, root, prefix)` recursively emits serializable command records.

Research should decide whether `CommandContract` is complete enough to replace `CliState` access for first-party projections.

### Selected Command State

Selection currently produces this state:

```ts
type SelectedCommand = {
  argv: {
    args: string[];
    options?: Record<string, unknown>;
  };
  entry: Entry;
  events: CliEventSubscription[];
  hooks: CliHooks;
  middlewares: MiddlewareHandler[];
  path: string[];
  rootDef?: CreateOptions;
};
```

Selection algorithm:

1. Start at `state.commands`, `state.root`, empty path, empty selected events/hooks/middleware.
2. For each token:
   - resolve aliases within the current command map
   - if token resolves to a group:
     - append canonical segment to path
     - descend into group commands
     - append group events/hooks/middleware
     - update current root to group root
   - if token resolves to a runtime entry:
     - return selected entry with remaining tokens as `argv.args`
3. If no leaf matches but current scope has a root command, return the current root with remaining tokens.
4. Otherwise return `undefined`.

Consequences:

- Group-level hooks/middleware/events are selected only along the path.
- Root fallback can run at the top level or inside a group.
- Unknown command tokens may become positional args for a root command.
- Unknown flag-like tokens with no selected command become parse errors in `run(cli)`.

Research should decide whether this selected-command state should remain private and whether a stable selection result is needed for adapters.

### Terminal Run Pipeline

`run(cli, argv, options)` currently delegates to an internal `runTerminalCli(name, state, argv, options)`.

`RunOptions`:

```ts
type RunOptions = {
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
  isTty?: boolean;
  stderr?: (s: string) => void;
  stdin?: AsyncIterable<string | Uint8Array> | ReadableStream<Uint8Array>;
  stdout?: (s: string) => void;
};
```

Terminal run flow:

1. Create IO writers from `options` or Bun stdout/stderr.
2. Resolve env from `options.env` or `Bun.env`.
3. Resolve `isTty` from `options.isTty` or `process.stdout.isTTY`.
4. Infer `invocation` as `ci` when common CI env vars are set; otherwise `cli`.
5. Parse global flags with `parseGlobals(argv, state.globals)`.
6. Compute output format:
   - `--json` forces `json`
   - `--format` wins when installed and supplied
   - selected command format can win later
   - root default format falls back to `json`
7. Handle completion mode when `env.COMPLETE` is set.
8. Handle `--version` when the version control installed the global.
9. Run matching `terminalHandlers` by flag key.
10. Select a command with `selectCommand(state, flags.rest)`.
11. If no command and rest includes flag-like tokens, emit parse failure and exit 1.
12. If no command or `--help`, render help.
13. If `--schema`, render selected command schema.
14. Run `prepareContext` hooks to build `contextOverrides`.
15. Call `execute(...)`.
16. Render result according to human/machine/envelope policy.
17. Apply output transforms.
18. Write stdout/stderr.
19. Call `exit(code)` or `process.exit(code)` for nonzero exit.

Important current result rendering policy:

```txt
human = !formatExplicit && !json && isTty
envelopeMode = state.def.generated?.machineOutput === "envelope" && formatExplicit
machineErrorEnvelope = !result.ok && !human

stdout data =
  fullOutput OR envelopeMode OR machineErrorEnvelope ? full Result
  : result.ok ? result.data
  : result.error
```

Open design issue: `run(cli)` is ergonomic but still coupled to IO and process exit.

### Execute Pipeline

`execute(binaryName, selected, input)` is public today but takes selected-command internals.

Current `ExecuteInput` shape:

```ts
type ExecuteInput = {
  agent: boolean;
  argvOptions: {
    args: string[];
    argsObject?: Dict;
    options?: Dict;
  };
  contextOverrides?: Partial<RunContext>;
  displayName: string;
  env: Dict;
  format: Format;
  formatExplicit: boolean;
  flags?: Dict;
  global?: GlobalOptions;
  hooks: CliHooks;
  inputSources?: readonly InputSourceProvider[];
  invocation: InvocationKind;
  isTty?: boolean;
  middlewares: MiddlewareHandler[];
  events: CliEventSubscription[];
  onChunk?: (chunk: unknown) => void | Promise<void>;
  onDeprecation?: (flag: string, option: string) => void;
  version?: string;
};
```

Execute flow:

1. Emit `command.selected`.
2. Emit `command.started`.
3. If selected entry is a fetch entry, call the fetch bridge and return its `Result`.
4. If selected entry is not a command, throw internal `COMMAND_NOT_RUNNABLE`.
5. Resolve command input:
   - parse command options and positionals
   - resolve env provider and extension input sources
   - merge explicit argv over provider values
   - parse args/env/options/vars through schemas
   - build `SourceInspector`
6. Build `RunContext`.
7. Apply `contextOverrides`.
8. Run `beforeExecute` hooks in order.
9. If a hook returns a branded `Result`, short-circuit.
10. Run root/group/command middleware stack.
11. Run command handler.
12. If handler returns branded `Result`, use it directly.
13. If handler returns async iterable:
   - stream chunks through `onChunk` when supplied
   - collect chunks into success data
14. Otherwise validate handler output through `runtime.output` schema.
15. Emit result lifecycle event.
16. Catch internal thrown values and normalize once through `toCommandError()`.

Open design issue: this is a useful pure execution primitive, but its input requires stateful selection internals. Research should design a stable public version or justify keeping it internal.

### Fetch Pipeline

`cli.fetch(request)` currently delegates to `fetchCli(name, state, request)`.

Fetch flow:

1. Parse `new URL(request.url)`.
2. Give `state.fetchRoutes` first chance to handle the request.
3. Convert URL path segments into command path tokens.
4. Select command with `selectCommand`.
5. If no command, return 404 result envelope.
6. For GET/HEAD, ignore request body.
7. For other methods, parse JSON body best-effort.
8. Merge URL search params and object JSON body into command options.
9. If request `Accept` includes `application/x-ndjson`, stream command chunks and final envelope.
10. Otherwise execute command with `format=json`, `formatExplicit=true`, `agent=true`, `invocation=agent`.
11. Return `Response.json(result, status)`.

Current fetch path uses `Bun.env` directly rather than `RunOptions.env` because fetch has no injected options object.

Open design issue: fetch is partly command dispatch, partly HTTP adapter, and partly MCP support. Research should decide which pieces are core primitives and which need adapter APIs.

### Parser and Global State

Global definitions:

```ts
type GlobalInputType = "boolean" | "string";

type GlobalInputDefinition = {
  key: string;
  type: GlobalInputType;
  flag?: string;
  alias?: string;
  expose?: "context" | "runtime";
  hidden?: boolean;
  deprecated?: boolean | string;
  description?: string;
  valueLabel?: string;
  parse?: (value: string, flag: string) => boolean | number | string;
};

type NormalizedGlobalInputDefinition =
  Omit<GlobalInputDefinition, "expose" | "flag"> & {
    expose: "context" | "runtime";
    flag: string;
  };

type GlobalFlags = {
  [key: string]: unknown;
  rest: string[];
  filterOutput?: string;
  format?: Format;
  formatExplicit?: boolean;
  fullOutput?: boolean;
  help?: boolean;
  json?: boolean;
  llms?: boolean;
  noSession?: boolean;
  nonInteractive?: boolean;
  profile?: string;
  schema?: boolean;
  version?: boolean;
};
```

Global normalization:

- `flag` defaults to kebab-case of `key`.
- leading `--` is stripped from long flags.
- leading `-` is stripped from aliases.
- `expose` defaults to `context`.
- duplicate long flags fail.
- aliases conflicting with long flags fail.
- duplicate aliases fail.

Global parsing:

- Recognizes registered long flags and single-character aliases.
- Unknown globals remain in `flags.rest` for command selection/command option parsing.
- Boolean globals with `--flag=value` are not consumed; they remain rest tokens.
- Value globals accept `--flag value` and `--flag=value`.
- Missing value throws `ParseError`.
- Parser hook errors are wrapped as `ParseError`.
- `json` and `format` set `formatExplicit`.

Command option parsing:

- Supports `--flag`, `--flag=value`, `--no-flag`, `-x`, and `--` literal boundary.
- Resolves option aliases from `input.aliases`.
- Matches camelCase and kebab-case option keys.
- Unknown command options throw `ParseError`.
- Boolean `--flag=false` and `--flag=true` are preserved.
- Explicit false and zero values are preserved.
- Deprecated options are collected for TTY warnings.

### Command Input Resolution State

Resolution produces:

```ts
type ResolvedCommandInput = {
  args: unknown;
  env: unknown;
  options: unknown;
  sources: SourceInspector;
  vars: unknown;
};

type OptionValueSource =
  | { kind: "argv" }
  | {
      kind: "provider";
      provider: string;
      path: string;
      source: InputSourceProvenance;
    }
  | { kind: "default" };

type InputSourceProvenance = Record<string, unknown> & {
  kind: string;
};
```

Input resolution order:

1. Parse command options from argv.
2. Mark argv-provided options as `{ kind: "argv" }`.
3. Resolve providers in order: built-in `env`, then declared `inputSources`.
4. For each declared option binding:
   - skip if argv explicitly provided that option
   - find provider by id
   - read provider path
   - if value is present, coerce string to boolean/number when schema says so
   - set option value and provenance
   - stop at first provider value
5. Parse args through args schema.
6. Parse env through env schema.
7. Parse options through options schema.
8. Parse root vars schema with `{}` to get defaults.
9. Build `SourceInspector`.

Missing provider registrations throw `ParseError`. Duplicate provider ids throw `ParseError`. Missing source values do not fail by themselves; schema validation decides whether the final option is required.

### Help Model State

Help rendering is model-based:

```ts
type HelpField = {
  name: string;
  label: string;
  usage: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
  env?: string;
  deprecated?: boolean | string;
};

type HelpCommand = {
  name: string;
  aliases: readonly string[];
  description?: string;
};

type HelpGlobal = {
  key: string;
  flag: string;
  label: string;
  alias?: string;
  description?: string;
  deprecated?: boolean | string;
};

type HelpModel = {
  name: string;
  path: readonly string[];
  usage: readonly string[];
  aliases: readonly string[];
  commands: readonly HelpCommand[];
  globals: readonly HelpGlobal[];
  args: readonly HelpField[];
  options: readonly HelpField[];
  examples: readonly Example[];
  description?: string;
  hint?: string;
};
```

Help model construction:

- Uses `commandScope(state, selected?.path ?? rest)` to determine scope.
- Lists child commands from `childCommands(scope)`.
- Uses selected command or group root runtime for args/options.
- Converts Zod object shapes into fields.
- Renders env provenance for options whose source binding uses provider `env`.
- Includes default values, descriptions, deprecated markers, aliases, hints, usage blocks, examples, and visible globals.
- Hidden globals do not appear.

Open design issue: help is mostly serializable, but model construction still reads `CliState`, `Entry`, and runtime schemas directly.

### Output Transform State

In addition to renderers, Core has output transforms:

```ts
type OutputTransform = {
  id: string;
  bufferingFlagKeys?: readonly string[];
  transform: (text: string, input: {
    flags: GlobalFlags;
    format: Format;
    stage: "result";
  }) => string;
};
```

Current behavior:

- Renderers convert values to text.
- Transforms run after final result rendering.
- If any transform declares a `bufferingFlagKeys` entry and that flag is present, streaming recap behavior changes because output must be buffered.
- This is a low-level text hook, not a value-level result hook.

Research question: should output transforms be public Core API, extension-only adapter API, or internal implementation detail?

### Terminal Handlers and Fetch Routes

Current side-channel adapter types:

```ts
type TerminalHandlerInput = {
  binaryName: string;
  flags: GlobalFlags;
  options: RunOptions;
  state: CliState;
};

type TerminalHandler = {
  flagKey: string;
  handle: (input: TerminalHandlerInput) => Promise<void> | void;
};

type FetchRouteInput = {
  binaryName: string;
  request: Request;
  state: CliState;
  url: URL;
};

type FetchRoute = {
  match: (url: URL) => boolean;
  handle: (input: FetchRouteInput) => Promise<Response>;
};
```

These are current extension lanes, but both receive raw `CliState`. This is one of the clearest signs that Core may need a stable adapter facade rather than public raw state.

### Lifecycle Event State

```ts
type CliEventType =
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
  | "mcp.initialize"
  | "mcp.tools_listed"
  | "mcp.tool_call.started"
  | "mcp.tool_call.completed"
  | "mcp.tool_call.failed"
  | "hook.failed";

type CliEventTarget = CliEventType | "*";

type CliEvent = {
  type: CliEventType;
  occurredAt: string;
  cli: { name: string; version?: string };
  invocation: InvocationKind;
  agent: boolean;
  format: Format;
  formatExplicit: boolean;
  command?: { id: string; path: readonly string[] };
  completion?: { shell?: string; suggestionCount?: number };
  error?: {
    code: string;
    exitCode?: number;
    fieldErrorCount?: number;
    retryable?: boolean;
    status?: number;
  };
  mcp?: { method: "initialize" | "tools/list" | "tools/call"; toolCount?: number };
  surface?: { kind: "command" | "completion" | "help" | "mcp" | "parse" | "schema" | "version"; name?: string };
  durationMs?: number;
  exitCode?: number;
  result?: "success" | "user_error" | "system_error" | "canceled";
};
```

Event behavior:

- `createLifecycleEvent()` adds `cli` and `occurredAt`.
- `emitLifecycleEvent()` filters subscriptions by target or `*`.
- Subscribers receive a shallow frozen snapshot with frozen nested event objects.
- Subscriber exceptions are swallowed.
- Hook exceptions are not swallowed; they become command failures.

### Hook State

```ts
type BeforeExecuteHook = (context: MiddlewareContext) => Awaitable<void | Result>;

type PrepareContextInput = {
  name: string;
  env: Dict<string | undefined>;
  flags: Dict;
};

type PrepareContextResult =
  | void
  | Result
  | { patch: Partial<RunContext> };

type PrepareContextHook = (input: PrepareContextInput) => Awaitable<PrepareContextResult>;

type CliHookRegistration = {
  beforeExecute?: BeforeExecuteHook | readonly BeforeExecuteHook[];
  prepareContext?: PrepareContextHook | readonly PrepareContextHook[];
};

type CliHooks = {
  beforeExecute: BeforeExecuteHook[];
  prepareContext: PrepareContextHook[];
};
```

Current behavior:

- `prepareContext` runs in the terminal run path before `execute()`.
- `prepareContext` can return `{ patch }` to override pieces of `RunContext`.
- A failing branded result from `prepareContext` is currently converted into a `ParseError` message, losing the full structured error.
- `beforeExecute` runs inside `execute()` after input resolution and before middleware.
- A branded failure result from `beforeExecute` short-circuits command execution.

Research should decide whether hook results need a clearer structured failure contract.

### Skill Metadata State

```ts
type SkillDefinition = {
  index?: string;
  markdown?: string;
};
```

Current behavior:

- Core can carry packaged skill content on the CLI or an extension.
- Optional skill installer packages handle writing/installing skill files.
- If skill content is absent, first-party skill runtime can reflect command contracts into skill markdown/index.

Research should decide whether packaged skill metadata belongs in Core or in an extension-only lane.

## Current Public Type Snapshot

The actual implementation has a large `types.ts`-style surface. Key types are summarized here.
This inventory is intentionally broad because the research output must be able to distinguish:

- public authoring types that should remain stable
- public extension-adapter types that may need a different stability tier
- private runtime-state types that are currently exported
- projection types that could replace raw state access

### Shared Primitives, Formats, and Global Control Types

```ts
type Dict<T = unknown> = Record<string, T>;
type Awaitable<T> = T | Promise<T>;

type BuiltInFormat = "json" | "yaml" | "md" | "jsonl";
type Format = BuiltInFormat | (string & {});
type OutputPolicy = "all" | "agent-only";
type InvocationKind = "cli" | "ci" | "agent" | "mcp";

type GlobalInputType = "boolean" | "string";

type GlobalInputDefinition = {
  alias?: string;
  deprecated?: boolean | string;
  description?: string;
  expose?: "context" | "runtime";
  flag?: string;
  hidden?: boolean;
  key: string;
  parse?: (value: string, flag: string) => boolean | number | string;
  type: GlobalInputType;
  valueLabel?: string;
};

type NormalizedGlobalInputDefinition =
  Omit<GlobalInputDefinition, "expose" | "flag"> & {
    expose: "context" | "runtime";
    flag: string;
  };

type GlobalOptions = Record<string, boolean | string | undefined> & {
  nonInteractive?: boolean;
  noSession?: boolean;
  profile?: string;
};

type GlobalFlags = {
  [key: string]: unknown;
  rest: string[];
  filterOutput?: string;
  format?: Format;
  formatExplicit?: boolean;
  fullOutput?: boolean;
  help?: boolean;
  json?: boolean;
  llms?: boolean;
  noSession?: boolean;
  nonInteractive?: boolean;
  profile?: string;
  schema?: boolean;
  version?: boolean;
};
```

Current behavior:

- `GlobalInputDefinition.expose = "context"` puts values into `ctx.global`.
- `expose = "runtime"` is used for runtime controls such as help, version, schema, JSON, and format flags.
- `GlobalFlags` is parse-state, not command context. It includes `rest`, which is the unconsumed argv slice used for command selection.
- `GlobalOptions` is command-context state. It intentionally omits internal `rest` and runtime-only controls.
- The current API does not clearly separate "global option authoring", "global parse state", and "command context globals".

Research should propose whether these should be split into separate namespaces or kept as one visible global-control model.

### Schema

```ts
import type { z } from "zod";

type Schema<T = unknown> = z.ZodType<T>;
type InferSchema<T> = T extends z.ZodType<infer O> ? O : unknown;
```

Research question: should Core openly commit to Zod 4 as its public schema contract, or define a smaller schema adapter?

### Results and Errors

```ts
type FieldError = {
  path: string;
  message: string;
  code?: string;
  missing?: boolean;
  expected?: string;
  received?: string;
};

type Cta =
  | string
  | {
      args?: Record<string, unknown>;
      command: string;
      description?: string;
      options?: Record<string, unknown>;
    };

type CtaBlock = {
  commands?: Cta[];
  description?: string;
};

type CommandError = {
  code: string;
  message: string;
  detail?: string;
  details?: Record<string, unknown>;
  exitCode?: number;
  fieldErrors?: FieldError[];
  hint?: string;
  retryable?: boolean;
  retry_after?: number | string;
  suggested_fix?: string;
  code_actions?: Array<{
    title: string;
    description?: string;
    command?: string;
    argv?: readonly string[];
  }>;
  type?: string;
  title?: string;
  status?: number;
  instance?: string;
};

type ResultMeta = Record<string, unknown> & {
  cta?: CtaBlock;
};

type Result =
  | { ok: true; data: unknown; error: null; meta?: ResultMeta }
  | { ok: false; data: null; error: CommandError; meta?: ResultMeta };
```

Current behavior:

- `ok(data, meta)`, `fail(error, meta)`, `ctx.ok()`, and `ctx.error()` create branded runtime results.
- Raw objects shaped like `{ ok, data, error }` are treated as domain data, not control results.
- `commandError()` fills defaults for `code`, `message`, `detail`, `exitCode`, `title`, and `type`.
- `ParseError` and `ValidationError` are currently exported, but docs say public command code should prefer object factories.
- Internal parser/schema/auth/HTTP code may throw typed internal errors; executor normalizes them into `CommandError`.

### Commands

```ts
type Example =
  | string
  | {
      args?: Record<string, unknown>;
      command?: string;
      description?: string;
      options?: Record<string, unknown>;
    };

type UsageObject = {
  args?: string[] | Partial<Record<string, true>>;
  options?: string[] | Partial<Record<string, true>>;
  prefix?: string;
  suffix?: string;
};

type Usage = string | UsageObject;

type CommandEffectKind =
  | "read"
  | "write"
  | "delete"
  | "exec"
  | "auth-session"
  | "auth-session-read"
  | "auth-session-write"
  | "auth-session-delete"
  | "auth-context-write";

type CommandEffects = {
  kind: CommandEffectKind;
  idempotent?: boolean;
};

type CommandPolicy = {
  conformanceEligible?: boolean;
  dangerous?: boolean;
  requiresConfirmation?: boolean;
};

type CommandSafety = {
  auth?: "none" | "optional" | "required";
  destructive?: boolean;
  idempotent?: boolean;
  interactive?: "never" | "optional" | "required";
  openWorld?: boolean;
  readOnly?: boolean;
};

type CommandAuthMetadata = {
  required: boolean;
  status: "not-required" | "requires-runtime-resolution";
  providerId?: string;
  envVars?: readonly string[];
  contexts?: readonly {
    id: string;
    envVar?: string;
    flag?: string;
  }[];
  requiredPermissions?: readonly string[];
  requiredScopes?: readonly string[];
};

type CommandContract = {
  name: string;
  path?: readonly string[];
  aliases?: readonly string[];
  summary?: string;
  description?: string;
  hint?: string;
  usage?: readonly Usage[];
  examples?: readonly Example[];
  schema?: unknown;
  format?: Format;
  outputPolicy?: "all" | "agent-only";
  agent?: boolean;
  auth?: CommandAuthMetadata;
  effects?: CommandEffects;
  policy?: CommandPolicy;
  safety?: CommandSafety;
};

type CommandManifest = {
  commands: CommandContract[];
  description?: string;
  name: string;
  version?: string;
};
```

Current behavior:

- `CommandContract` is the intended serializable reflection boundary.
- Help, manifest, MCP tools, skills, and agent references should be derivable from command contracts without executing handlers.
- Safety metadata can lower into effects and policy when `safety` is declared.
- `CommandAuthMetadata` intentionally describes auth requirements and unresolved runtime needs. It does not carry live credentials.
- `CommandManifest` is a serializable package/CLI projection, not executable state.

### CLI Authoring

```ts
type DefineCliOptions = {
  name: string;
  version?: string;
  description?: string;
  commands?: readonly DeclarativeCommand[];
  extensions?: readonly CliExtension[];
  globals?: readonly GlobalInputDefinition[];
  events?: readonly CliEventRegistration[];
  hooks?: CliHookRegistration;
  middleware?: readonly MiddlewareHandler[];
  inputSources?: readonly InputSourceProvider[];
  outputRenderers?: readonly OutputRenderer[];
  outputTransforms?: readonly OutputTransform[];
  terminalHandlers?: readonly TerminalHandler[];
  fetchRoutes?: readonly FetchRoute[];
  helpRenderer?: HelpRenderer;
  skill?: SkillDefinition;
  vars?: Schema<any>;
  generated?: { machineOutput: "envelope" };
};

type DeclarativeCommand = {
  path: readonly [string, ...string[]];
  aliases?: readonly (readonly string[])[];
  summary?: string;
  description?: string;
  hint?: string;
  usage?: Usage[];
  examples?: Example[];
  input?: {
    args?: Schema<any>;
    env?: Schema<any>;
    options?: Schema<any>;
    sources?: {
      options?: Record<string, readonly InputSourceBinding[]>;
    };
  };
  output?: Schema<any>;
  format?: Format;
  outputPolicy?: "all" | "agent-only";
  agent?: boolean;
  auth?: CommandAuthMetadata;
  effects?: CommandEffects;
  policy?: CommandPolicy;
  safety?: CommandSafety;
  middleware?: MiddlewareHandler[];
  run?: (context: {
    ctx: RunContext;
    input: { args: unknown; env: unknown; options: unknown };
  }) => unknown | Promise<unknown> | AsyncGenerator<unknown>;
};

type CliInstance = {
  name: string;
  description?: string;
  env?: Schema<any>;
  vars?: Schema<any>;
  fetch(request: Request): Promise<Response>;
};
```

Additional authoring types that matter for API design:

```ts
type CommandInput<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  aliases?: Record<string, string>;
  args?: A;
  env?: E;
  options?: O;
  sources?: {
    options?: Record<string, readonly InputSourceBinding[]>;
  };
};

type DeclarativeCommandRunContext<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  ctx: RunContext<InferSchema<A>, InferSchema<O>, InferSchema<E>, Record<string, unknown>>;
  input: {
    args: InferSchema<A>;
    env: InferSchema<E>;
    options: InferSchema<O>;
  };
};

type CommandDefinition<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = {
  // Legacy/runtime-shaped command definition.
  // Declarative commands omit alias/aliases/args/env/options/run and rewrap them
  // under path/input/run context.
  agent?: boolean;
  alias?: Record<string, string>;
  aliases?: string[];
  args?: A;
  auth?: CommandAuthMetadata;
  description?: string;
  effects?: CommandEffects;
  env?: E;
  examples?: Example[];
  format?: Format;
  hint?: string;
  middleware?: MiddlewareHandler[];
  options?: O;
  output?: Out;
  outputPolicy?: OutputPolicy;
  policy?: CommandPolicy;
  run?: (
    context: RunContext<InferSchema<A>, InferSchema<O>, InferSchema<E>, Record<string, unknown>>
  ) => unknown | Promise<unknown> | AsyncGenerator<unknown> | void;
  safety?: CommandSafety;
  sources?: {
    options?: Record<string, readonly InputSourceBinding[]>;
  };
  summary?: string;
  usage?: Usage[];
};

type CreateOptions<
  A extends Schema<any> | undefined = Schema<any> | undefined,
  E extends Schema<any> | undefined = Schema<any> | undefined,
  O extends Schema<any> | undefined = Schema<any> | undefined,
  Out extends Schema<any> | undefined = Schema<any> | undefined,
> = CommandDefinition<A, E, O, Out> & {
  events?: readonly CliEventRegistration[];
  fetchRoutes?: readonly FetchRoute[];
  format?: Format;
  generated?: { machineOutput: "envelope" };
  globals?: readonly GlobalInputDefinition[];
  helpRenderer?: HelpRenderer;
  hooks?: CliHookRegistration;
  inputSources?: readonly InputSourceProvider[];
  name?: string;
  outputRenderers?: readonly OutputRenderer[];
  outputTransforms?: readonly OutputTransform[];
  terminalHandlers?: readonly TerminalHandler[];
  skill?: SkillDefinition;
  sync?: {
    cwd?: string;
    depth?: number;
    include?: string[];
    suggestions?: string[];
  };
  vars?: Schema<any>;
  version?: string;
};
```

Current behavior:

- `defineCli()` freezes no public builder object. There are no fluent runtime mutators.
- `defineCommand()` freezes command path and alias arrays.
- `defineCli({ builtins })` is explicitly removed.
- A minimal CLI has no implicit `--help`, `--version`, `--json`, `--format`, `--schema`, or `--llms`.
- Standard flags are installed only by controls or extensions.
- `DefineCliOptions` is `CreateOptions` plus required `name`, optional declarative `commands`, and optional `extensions`.
- Root `CreateOptions` can itself be runnable or fetchable. This creates `state.root`.
- `sync` remains in the type surface. Research should identify whether it is live, stale, or misplaced Product state.

### Run Context

```ts
type RunContext<A = object, O = object, E = object, V = object> = {
  name: string;
  displayName: string;
  invocation: "cli" | "ci" | "agent" | "mcp";
  isTty: boolean;
  agent: boolean;
  format: Format;
  formatExplicit: boolean;
  global: Record<string, boolean | string | undefined>;
  args: A;
  options: O;
  env: E;
  var: V;
  sources: SourceInspector;
  set(key: string, value: unknown): void;
  ok(data?: unknown, meta?: ResultMeta): Result;
  error(input: CommandError & { cta?: ResultMeta["cta"] }): Result;
};

type MiddlewareContext = RunContext;

type MiddlewareHandler = (
  context: MiddlewareContext,
  next: () => Promise<void>
) => Awaitable<unknown>;
```

Current behavior:

- Middleware can mutate `ctx.var` through `ctx.set()`.
- Middleware composes as a stack around the command handler. A middleware must call `next()` to continue execution.
- `vars` schema defaults populate `ctx.var`; middleware writes override defaults.
- Explicit `--json` or `--format` sets `ctx.agent = true` even on a TTY.
- CI invocation is inferred from common CI env vars unless a generated wrapper passes a mode explicitly.

### Extensions

```ts
type CliExtension = {
  id: string;
  commands?: readonly DeclarativeCommand[];
  globals?: readonly GlobalInputDefinition[];
  inputSources?: readonly InputSourceProvider[];
  outputRenderers?: readonly OutputRenderer[];
  outputTransforms?: readonly OutputTransform[];
  terminalHandlers?: readonly TerminalHandler[];
  fetchRoutes?: readonly FetchRoute[];
  events?: readonly CliEventRegistration[];
  hooks?: CliHookRegistration;
  middleware?: readonly MiddlewareHandler[];
  helpRenderer?: HelpRenderer;
  skill?: SkillDefinition;
};
```

Extension-adjacent adapter types:

```ts
type RunOptions = {
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
  isTty?: boolean;
  stderr?: (s: string) => void;
  stdin?: AsyncIterable<string | Uint8Array> | ReadableStream<Uint8Array>;
  stdout?: (s: string) => void;
};

type TerminalHandlerInput = {
  binaryName: string;
  flags: GlobalFlags;
  options: RunOptions;
  state: CliState;
};

type TerminalHandler = {
  flagKey: string;
  handle: (input: TerminalHandlerInput) => Promise<void> | void;
};

type OutputTransformInput = {
  flags: GlobalFlags;
  format: Format;
  stage: "result";
};

type OutputTransform = {
  id: string;
  bufferingFlagKeys?: readonly string[];
  transform: (text: string, input: OutputTransformInput) => string;
};

type FetchRouteInput = {
  binaryName: string;
  request: Request;
  state: CliState;
  url: URL;
};

type FetchRoute = {
  match: (url: URL) => boolean;
  handle: (input: FetchRouteInput) => Promise<Response>;
};

type SkillDefinition = {
  index?: string;
  markdown?: string;
};
```

Current behavior:

- Extensions are plain frozen data objects.
- Extension ids are currently only diagnostic labels; an id regex was removed because it did not enforce a real invariant.
- `defineCli()` composes extension arrays by concatenating commands, globals, input sources, output renderers, output transforms, terminal handlers, fetch routes, events, hooks, and middleware.
- `helpRenderer` and `skill` are singleton extension values. Declaring more than one provider or declaring one at both root and extension level fails.
- Duplicate global flags or aliases fail during CLI creation.
- Duplicate custom output renderer names fail during CLI creation. Custom renderers may replace built-in renderer names.
- Some optional packages still need access to low-level state/execution helpers to implement MCP and skill surfaces.
- `TerminalHandlerInput` and `FetchRouteInput` currently pass raw `CliState`, so these are not cleanly separated extension APIs.

### Current Internal State Types Exposed Publicly

The package root currently exposes `getCliState` and the `CliState` type, even though docs say generated code should not depend on raw state.

```ts
type CliState = {
  commands: Map<string, Entry>;
  def: CreateOptions;
  events: CliEventSubscription[];
  fetchRoutes: readonly FetchRoute[];
  globals: readonly NormalizedGlobalInputDefinition[];
  helpRenderer?: HelpRenderer;
  hooks: CliHooks;
  inputSources: readonly InputSourceProvider[];
  middlewares: MiddlewareHandler[];
  outputRenderers: readonly OutputRenderer[];
  outputTransforms: readonly OutputTransform[];
  root?: RuntimeEntry;
  terminalHandlers: readonly TerminalHandler[];
};

type SelectedCommand = {
  argv: { args: string[]; options?: Record<string, unknown> };
  entry: Entry;
  events: CliEventSubscription[];
  hooks: CliHooks;
  middlewares: MiddlewareHandler[];
  path: string[];
  rootDef?: CreateOptions;
};
```

Current low-level public helpers include:

```ts
getCliState(cli): CliState;
selectCommand(state, tokens): SelectedCommand | undefined;
execute(binaryName, selected, input): Promise<Result>;
createLifecycleEvent(...): CliEvent;
emitLifecycleEvent(...): Promise<void>;
eventCommand(selected): CliEventCommand;
mergeHooks(...): CliHooks;
collectCommandContracts(commands, root?): CommandContract[];
manifest(name, state): CommandManifest;
manifestEnvelope(name, state): CommandManifest & { manifestVersion: string };
mcpToolName(name): string;
```

Research question: is this a real public adapter API, an accidental exposure for first-party packages, or a sign that Core needs a stable `CliRuntime`, `CommandDispatcher`, or `cli.run()` abstraction?

State-design facts the research output must account for:

- `CliState.commands` and `GroupEntry.commands` are mutable `Map` instances.
- `CommandRuntime`, middleware, hooks, input sources, renderers, transforms, and handlers contain functions and are not serializable.
- `CommandContract`, `CommandManifest`, `HelpModel`, and lifecycle events are the main serializable projections.
- Alias entries are sibling pointers, not full-path links.
- Group entries can carry a root runtime plus child commands.
- Selection output carries accumulated group/root events, hooks, and middleware. That means command execution cannot be reconstructed from a leaf entry alone.
- `state.def` is the expanded root authoring object, not a sanitized runtime descriptor.
- `state.root` is present only when the root definition has `run` or `fetch`.
- `getCliState()` makes all of the above observable through the package root today.

### Input Sources and Config Boundary

```ts
type InputSourceBinding = {
  provider: string;
  path: string;
};

type InputSourceProvider = {
  id: string;
  resolve(input: {
    commandPath: readonly string[];
    env: Record<string, string | undefined>;
    flags: Record<string, unknown>;
  }): ResolvedInputSource | Promise<ResolvedInputSource>;
};

type ResolvedInputSource = {
  get(path: string): unknown;
  source(path: string): InputSourceProvenance;
};

type InputSourceResolveInput = {
  commandPath: readonly string[];
  env: Record<string, string | undefined>;
  flags: Record<string, unknown>;
};

type SourceInspector = {
  value(provider: string, path: string): unknown;
  source(provider: string, path: string): InputSourceProvenance;
  option(name: string): OptionValueSource;
};
```

Current behavior:

- Env is always available as a built-in input-source provider.
- External providers resolve in declaration order.
- Option precedence is `argv > declared input sources in order > schema default`.
- Option-to-source binding is explicit. Matching option names do not automatically bind to config keys.
- Providers return raw values; Core coerces string provider values to boolean or number based on the option schema.
- `@liche/config` owns file formats, discovery, `--config`, `--no-config`, and config diagnostics.
- Some older docs still describe config parsing/resolution as core-owned. Treat that as a contradiction to resolve.

### Output Rendering

```ts
type BuiltInFormat = "json" | "yaml" | "md" | "jsonl";
type Format = BuiltInFormat | (string & {});

type OutputRenderStage = "schema" | "chunk" | "result";

type OutputRenderContext = {
  format: Format;
  stage: OutputRenderStage;
};

type OutputRenderer = {
  name: Format;
  mediaType?: string;
  render(value: unknown, context: OutputRenderContext): string;
};
```

Current behavior:

- Built-in renderers: `json`, `jsonl`, `yaml`, `md`.
- Default output format is JSON.
- `outputControls({ json: true })` installs `--json`.
- `outputControls({ format: true, formats: [...] })` installs `--format`.
- Installing a renderer does not install a global flag. The CLI must explicitly expose format controls.
- Handwritten CLI success output under explicit JSON is bare `data` unless `--full-output` is used or generated envelope mode is enabled.
- Non-human failures emit the full `{ ok, data, error, meta }` envelope.
- Generated CLIs can opt into `generated: { machineOutput: "envelope" }` so explicit machine output always returns the full envelope.
- Async generator commands stream one line per yield in CLI mode. Fetch with `Accept: application/x-ndjson` returns chunk lines plus a final envelope.

Research question: should the handwritten/generator split remain, or should Core default toward one machine envelope contract for script and agent reliability?

### Help and Reflection

```ts
type HelpModel = {
  name: string;
  path: readonly string[];
  usage: readonly string[];
  aliases: readonly string[];
  commands: readonly HelpCommand[];
  globals: readonly HelpGlobal[];
  args: readonly HelpField[];
  options: readonly HelpField[];
  examples: readonly Example[];
  description?: string;
  hint?: string;
};

type HelpRenderContext = {
  binaryName: string;
  path: readonly string[];
};

type HelpRenderer = (model: HelpModel, context: HelpRenderContext) => string;
```

Current behavior:

- `help()` installs `--help` and `-h`.
- `help({ renderer })` customizes explicit help, fallback help, and human validation help.
- `defaultHelpRenderer()` is public so users can wrap the default layout.
- Fallback help can still render when no command is selected even though `--help` itself is opt-in.
- `reflectionControls({ schema: true })` installs `--schema`.
- Command schema reflection is currently Zod-backed.

### Lifecycle, Hooks, and Events

Current event types include:

```txt
command.selected
command.started
command.completed
command.failed
validation.failed
parse.failed
command.not_found
help.rendered
version.rendered
completion.generated
schema.generated
mcp.initialize
mcp.tools_listed
mcp.tool_call.started
mcp.tool_call.completed
mcp.tool_call.failed
hook.failed
```

Public event and hook type declarations:

```ts
type CliEventTarget = CliEventType | "*";

type CliEventCommand = {
  id: string;
  path: readonly string[];
};

type CliEventCompletion = {
  shell?: string;
  suggestionCount?: number;
};

type CliEventError = {
  code: string;
  exitCode?: number;
  fieldErrorCount?: number;
  retryable?: boolean;
  status?: number;
};

type CliEventMcp = {
  method: "initialize" | "tools/list" | "tools/call";
  toolCount?: number;
};

type CliEventSurface = {
  kind: "command" | "completion" | "help" | "mcp" | "parse" | "schema" | "version";
  name?: string;
};

type CliEvent = {
  agent: boolean;
  cli: { name: string; version?: string };
  command?: CliEventCommand;
  completion?: CliEventCompletion;
  durationMs?: number;
  error?: CliEventError;
  exitCode?: number;
  format: Format;
  formatExplicit: boolean;
  invocation: InvocationKind;
  mcp?: CliEventMcp;
  occurredAt: string;
  result?: "success" | "user_error" | "system_error" | "canceled";
  surface?: CliEventSurface;
  type: CliEventType;
};

type CliEventSubscriber = (event: Readonly<CliEvent>) => Awaitable<void>;

type CliEventRegistration =
  | CliEventSubscriber
  | {
      subscriber: CliEventSubscriber;
      target: CliEventTarget;
    };

type CliEventSubscription = {
  subscriber: CliEventSubscriber;
  target: CliEventTarget;
};

type BeforeExecuteHook = (context: MiddlewareContext) => Awaitable<void | Result>;

type PrepareContextInput = {
  name: string;
  env: Dict<string | undefined>;
  flags: Dict;
};

type PrepareContextResult =
  | void
  | Result
  | { patch: Partial<RunContext> };

type PrepareContextHook = (input: PrepareContextInput) => Awaitable<PrepareContextResult>;

type CliHookRegistration = {
  beforeExecute?: BeforeExecuteHook | readonly BeforeExecuteHook[];
  prepareContext?: PrepareContextHook | readonly PrepareContextHook[];
};

type CliHooks = {
  beforeExecute: BeforeExecuteHook[];
  prepareContext: PrepareContextHook[];
};
```

Current behavior:

- Lifecycle subscribers are observe-only.
- Subscriber failures do not change command results.
- `beforeExecute` hooks run before middleware and handlers.
- Hook failures are command failures.
- Events are redacted. They omit raw argv, raw request payloads, raw field errors, secrets, and unresolved user input.
- Telemetry sinks should consume an explicit allowlist rather than every lifecycle event.

### Auth and Secret Primitives

```ts
type SecretString = {
  readonly kind: "liche.secret";
  reveal(): string;
  toJSON(): "[redacted]";
  toString(): "[redacted]";
};

type AuthCredential = {
  providerId: string;
  source: "env" | "session";
  profile?: string;
  kind: "bearer" | "apiKey";
  secret: SecretString;
  header?: string;
  account?: { id: string; label?: string };
  scopes?: string[];
  expiresAt?: string;
  refreshAvailable: boolean;
};

function secret(value: string): SecretString;
function applyAuth(headers: Headers, credential: AuthCredential): void;
```

Current behavior:

- `secret()` redacts through `toString()` and `toJSON()`.
- `applyAuth()` writes bearer or API key credentials into headers.
- Auth/session workflow helpers live in `@liche/auth`, not Core.
- HTTP transport maps 401/403 with resolved auth into structured auth errors when possible.

### HTTP Operation Transport

```ts
type RuntimeValue =
  | { envVar: string; literal?: string }
  | { envVar?: string; literal: string };

type HttpAuth =
  | { kind: "none" }
  | { kind: "bearer"; envVar: string }
  | { kind: "apiKey"; envVar: string; header: string }
  | { kind: "resolved"; credential: AuthCredential };

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type HttpOperationBind<TInput = Record<string, unknown>> = {
  path?: Array<keyof TInput & string>;
  query?: Array<keyof TInput & string>;
  headers?: Record<string, keyof TInput & string>;
  body?: true | Array<keyof TInput & string> | false;
};

type HttpOperationRequestSpec<TInput> = {
  id?: string;
  baseUrl: RuntimeValue | string;
  auth?: HttpAuth;
  method: HttpMethod;
  path: string;
  bind: HttpOperationBind<TInput>;
  input: TInput;
  inputFields?: readonly (keyof TInput & string)[];
  env?: Record<string, string | undefined>;
};

type HttpOperationCall<TInput, TOutput> =
  HttpOperationRequestSpec<TInput> & {
    output: Schema<TOutput>;
    fetch?: HttpFetch;
    timeoutMs?: number;
    safeBodyBytes?: number;
    requiredPermissions?: readonly string[];
  };
```

Current behavior:

- `serializeHttpOperationRequest()` performs pure request serialization.
- `callHttpOperation()` serializes, fetches, parses JSON, validates output, and returns parsed output on success.
- Transport failures throw structured internal errors that the executor maps into `CommandError`.
- Timeout default is 30 seconds.
- There is no automatic retry.
- Body preview in errors is capped and sanitized.
- Generated callers pass `inputFields` to catch dead or typoed binds before network work.
- Config-backed Product remote base URLs are resolved before transport through `ctx.sources`.

### Fetch and MCP Surface

Current behavior:

- `cli.fetch(request)` dispatches URL paths to registered commands and returns result envelopes.
- Fetch can expose MCP endpoint behavior and command dispatch.
- Optional MCP server packages moved out of Core, but they still depend on Core command contracts, state, selection, execution, and lifecycle helpers.
- MCP tool names replace whitespace with underscores.
- Commands with `agent: false` are hidden from MCP `tools/list` and cannot be invoked by guessing the tool name.

## Recent Direction Changes

The recent direction is simplification and package boundary cleanup:

- `refactor(core): decompose monolithic error and http modules`
  - split broad error handling into typed error classes, result factories, and normalization
  - split HTTP operation transport into request serialization, response parsing, auth application, error construction, and orchestration
- `refactor(core): split parser/config and mcp/protocol; delete command barrel`
  - pulled config parsing helpers into clearer parser submodules first
  - moved MCP protocol pieces toward a separate boundary
  - removed the command barrel to tighten import shape
- `refactor(core): drop gratuitous extension id regex`
  - removed extension-id format validation because the id was only a diagnostic label
  - kept duplicate behavior focused on concrete resource conflicts, such as globals and renderer names
- `feat(core): move optional surfaces to extension primitives`
  - deleted Core-owned config file parsing and JSONC/path merge helpers
  - deleted Core-owned MCP protocol/server modules
  - deleted Core-owned skill markdown generation
  - added generic extension primitives: input sources, output renderers/transforms, terminal handlers, fetch routes, lifecycle events, and singleton help/skill providers
  - widened `types.ts` substantially so optional first-party packages could compile against root exports
- `feat(extensions): add token controls`
  - moved token-related output behavior out of Core
  - added output transform state so extension packages can post-process rendered text
  - removed token controls and token renderer code from Core
- `chore(release): prepare 0.5.0 publish`
  - updated package metadata and release state for synchronized public package publication
  - package-root API snapshots currently freeze the broad export list as observed state

Snapshot-scale impact:

- Core became smaller in owned product features but larger in public low-level primitives.
- The strongest open question is now not "what optional feature belongs in Core?" but "what stable adapter API should optional packages use instead of raw `CliState`?"
- Recent changes deliberately favored deletion over compatibility aliases. Keep that bias unless research finds a concrete consumer break that cannot be handled before `1.0.0`.

- Standard globals are now explicit controls. A plain `defineCli()` reserves no user-visible flags.
- Optional config, auth workflows, completions, MCP installer, skills installer, telemetry, token controls, and agent helpers moved out of Core into extension packages.
- Old core installer helpers were deleted rather than kept as compatibility aliases.
- MCP server protocol code moved out of Core into an optional package, though Core still has command-contract and direct execution primitives.
- Monolithic error code was split into error classes, result factories, and normalization.
- Monolithic HTTP transport was split into request binding, response parsing, auth application, error construction, and orchestration.
- Extension id regex validation was removed because ids were only used in error messages.
- Public package snapshots currently freeze the broad root surface.

Do not recommend adding removed optional workflows back to Core. The research question is whether the remaining public low-level lanes are the right abstraction after this cleanup.

## Known Contradictions and Friction

Treat these as primary research targets.

1. Public surface versus boundary intent
   - Boundary intent says generated code should not depend on `CliState`, raw registry entries, parser helpers, or error classes.
   - Current public root exposes `getCliState`, `CliState`, `selectCommand`, `execute`, lifecycle helper functions, `ParseError`, and `ValidationError`.
   - Decide whether to keep, remove, move to unstable subpaths, or replace them with a stable adapter API.

2. First-party extensions still need internals
   - MCP and skills runtime adapters appear to need state, command contracts, selection, and execution.
   - Current answer is exposing internals through the package root.
   - Research whether Core should expose a read-only `CliRuntime`, `CommandDispatcher`, `ProjectionHost`, or `cli.run()` instead.

3. No pure command-run API
   - `run(cli)` writes stdout/stderr and exits by default.
   - `cli.fetch()` speaks HTTP.
   - `execute()` returns `Result` but requires internal selected-command/state-shaped inputs.
   - Research whether Core needs public `cli.run(argv, options): Promise<Result>` or `cli.dispatch(commandPath, input, options): Promise<Result>`.

4. Schema abstraction may be dishonest
   - Docs sometimes imply generic schema support.
   - Actual public type is `z.ZodType<T>` with `z` re-exported.
   - Decide whether to embrace Zod 4 as public or design a smaller adapter contract.

5. Error lane split is unclear for extension authors
   - Command authors should return `fail(commandError(...))`.
   - Deep internals throw typed errors.
   - Extensions currently import `ParseError` and `ValidationError` for parser/config failure behavior.
   - Decide what public failure API extension authors should use.

6. Type surface mixes layers
   - Public authoring types, extension adapter types, runtime state types, and internal registry types live in one conceptual type surface.
   - Propose a clean split between public authoring, public extension adapters, and private runtime state.

7. Output contract split may be costly
   - Handwritten success under `--json` returns bare data.
   - Generated machine output can return full envelopes.
   - Failures return envelopes in non-human mode.
   - Decide whether scripts and agents need a single envelope default.

8. Config ownership docs are inconsistent
   - Current direction: Core owns generic input-source resolution and provenance. `@liche/config` owns config files and flags.
   - Some state/docs still describe parser/config/env validation as Core-owned.
   - Propose the exact boundary.

9. OpenAPI rows are stale in old coverage state
   - Core previously had OpenAPI emit/ingest requirements.
   - Current direction says OpenAPI belongs to Product.
   - Decide how to remove or reclassify stale Core requirements.

10. Extension identity may be under-modeled
   - Extension ids currently only label errors.
   - Decide whether duplicate extension ids, ordering constraints, dependency declarations, or conflict reporting deserve a model.

11. Package consumer proof may be too shallow
   - Current snapshots prove package-root keys.
   - Decide whether temp-consumer installs, packed file inspection, and real example smokes should gate Core API changes.

## Competitor Research Required

Use current official docs and source for competitors. Include at least:

- Commander
- Yargs
- Oclif
- Clipanion
- Citty
- Clack, for interactive UX boundaries rather than full command graph replacement
- Hono or a similar small runtime only when comparing dispatch/composition patterns

Compare both:

- Framework authoring experience
- Downstream CLI consumption experience

Minimum benchmark fixture:

```txt
tool status
tool deploy <entrypoint> [--dry-run] [--json]
tool users list [--limit N]
tool config doctor --json
tool login/logout/whoami or equivalent auth surface when the framework supports it
```

Score each framework against:

- nested command authoring
- type inference
- schema validation
- unknown option behavior
- explicit global controls
- config/default/provenance model
- structured errors
- JSON output stability
- full result envelope support
- CTA/recovery metadata
- help customization
- lifecycle/telemetry hooks
- plugin/extension authoring
- command manifest/static analysis
- agent/MCP friendliness
- non-interactive safety
- streaming behavior
- testability without spawning a process

The benchmark should produce a rubric and runnable fixture descriptions. If you cannot run code, still define exact fixture commands, expected stdout/stderr/status behavior, and scoring criteria.

## Required Recommendations

### Public API Recommendation

Provide an exact proposed package-root export list. For each currently exported value, classify it:

```txt
keep public
remove
rename
move to unstable/internal subpath
replace with new API
```

Pay special attention to:

- `getCliState`
- `CliState`
- `SelectedCommand`
- `Entry`
- `selectCommand`
- `execute`
- lifecycle helper functions
- `ParseError`
- `ValidationError`
- `parseSchema`
- `Formatter`
- `manifest` and `manifestEnvelope`
- `collectCommandContracts`
- `mcpToolName`

### Internal Architecture Recommendation

Propose a module/layer split for:

- command authoring
- parser/global parsing
- command input resolution
- command selection
- command execution
- output rendering
- result/error normalization
- lifecycle events and hooks
- extension composition
- command-contract projection
- fetch/MCP dispatch
- HTTP operation transport
- auth redaction primitives

Name what is private state, what is public command metadata, and what extension adapters can see.

### Agent and Static Analysis Recommendation

Decide whether `CommandContract` needs more fields for:

- env requirements
- config source bindings
- output/envelope mode
- streaming mode
- safety/effects
- auth/session posture
- non-interactive requirements
- examples and recovery CTAs
- machine-readable command ids

### Test and Release Gate Recommendation

Define the tests that should be written before implementation. Include:

- package-root API snapshot
- external package consumer proof
- extension-lane tests
- pure run/dispatch tests if proposed
- output/envelope tests
- error normalization tests
- config/input provenance tests
- temp-consumer install or pack inspection
- example smokes
- mutation/property tests where useful

### Reviewable Implementation Sequence

Give a commit-by-commit plan. Each commit must include:

- goal
- affected API/type/module concepts
- behavior to preserve or intentionally break
- tests to add first
- verification command or proof

## Final Instruction

Be direct. If the current public surface is too wide, say so and remove it. If first-party extensions need a real adapter surface, design that surface instead of pretending internals are stable. If Zod is the actual schema contract, either embrace it or specify the adapter work required to make the generic claim true. Avoid broad "plugin architecture" advice unless it names the concrete API, data shape, and verification.

# Core API boundary

This is the public API contract for `@liche/core`. It records what is public, what stays internal, and the decision rule for future widening.

Public means importable from `@liche/core`. Tests may import source subpaths for white-box coverage, but those imports do not define the package API. The package export map exposes only `"."`, so generated code and downstream packages do not depend on `packages/core/src/*` subpaths.

The public surface is locked by `packages/core/test/api-snapshot.test.ts` (source-local snapshot) and `packages/product/test/core-consumer-boundary.test.ts` (package-root consumer proof).

## Rules

- Handwritten CLI code declares commands through `defineCli()` / `defineCommand()` and uses core runtime behavior through documented top-level APIs only.
- Generated CLI code declares through `defineCli()` / `defineCommand()` and does not depend on internal registry state.
- Generated code does not import `stateSymbol`, `InternalCli`, `CliState`, parser helpers, command registry helpers, command guards, help renderers, or schema-adapter internals.
- Runtime reflection in core is backed by serializable `CommandContract` records, not raw `Entry` / `CliState` inspection. Product-generated OpenAPI, MCP, docs, Agent Skill, and command manifest surfaces belong to `@liche/product` when the Product catalog is the source of truth.
- The public surface widens only when an extension cannot be implemented through public lanes without importing internals, mutating hidden runtime state, eagerly importing implementation modules, or duplicating parser/executor/security/provenance behavior. The widening adds a reusable lane, not a one-off helper.

`packages/core/test/extension-lane-coverage.test.ts` is the mechanical check for the last rule. It builds representative optional features using only package-root imports: a command-registration/input-source provenance extension, an observe-only lifecycle subscriber, and a non-interactive policy hook. The fixture also proves disabled extensions leave baseline command output unchanged. A core widening starts with a failing extension-lane case that demonstrates the missing public lane.

## Public surface

### Values

| Export | Purpose |
|---|---|
| `defineCli` | Canonical handwritten CLI authoring helper for data-first command graphs. |
| `defineCommand` | Canonical command declaration helper for analyzable command metadata plus a handler. |
| `run` | Top-level effectful CLI entrypoint. Runs `argv ?? Bun.argv.slice(2)` through the terminal runner — writes stdout/stderr and exits the process unless overridden by `RunOptions`. |
| `dispatch` | Result-returning execution lane for extensions or adapters that drive a command without writing stdout/stderr or calling `process.exit`. Returns the same `Result` envelope `run(cli, argv)` prints under `--json`. |
| `parseInvocation` | Result-returning parse-only lane. Runs argv parsing, command selection, `prepareContext` hooks, and input decoding with provenance, then returns a `ParsedInvocation` without invoking the handler. Emits no lifecycle events; deprecation findings surface as `warnings` on the result. Returns `Result.fail` with structured codes for `--help` / `--version` / `--schema` / `COMPLETE` / terminal-handler flags (those remain `run`-only), unknown commands (`COMMAND_NOT_FOUND`), and fetch entries (`COMMAND_NOT_RUNNABLE`). |
| `defineExtension` | Canonical extension declaration helper; validates the extension id and freezes the result. |
| `defineGlobal` | Canonical global flag declaration helper for reusable parser/help/context metadata. |
| `defineOutputRenderer` | Canonical output renderer declaration helper for named final-value renderers. |
| `help`, `version`, `outputControls`, `reflectionControls` | Opt-in Core controls that install standard runtime globals such as `--help`, `--version`, `--json`, `--format`, and `--schema`. |
| `defaultHelpRenderer` | Default renderer for the serializable help model; custom `help({ renderer })` implementations can wrap it. |
| `middleware` | Around-command middleware authoring helper. |
| `z` | Public schema authoring convenience (re-exported Zod). |
| `arg` | Namespace of strict Zod schema factories for CLI/env/fetch string boundaries. Built-ins: `arg.number()`, `arg.int()`, `arg.positiveInt()`, `arg.port()`, `arg.boolean()`, `arg.fromString({ output, decode, surface?, input?, encode? })`. Each returns an ordinary Zod schema (so `.optional()`, `.default()`, `.describe()` compose) but uses ASCII decimal grammar instead of broad `Number()` coercion; boolean accepts only `"true"`/`"false"`/`"1"`/`"0"` plus JSON booleans. `arg.fromString` lets a CLI-shaped string be decoded into a runtime value (URL, ReadableStream, parsed file contents); `surface` (default `'cli'`) declares which dispatch transports may invoke the codec — adapters use `checkCommandSurface` to enforce it. |
| `checkCommandSurface` | Adapter-callable predicate: `(entry, surface) => { ok: true } \| { ok: false; field; codecKind; surface }`. Walks a command's `args`/`options`/`env` schemas, including bare positional codecs, nested object fields, Zod wrappers, and parse-executing composites, and returns a structured rejection when any `arg.fromString` codec's stored surface policy excludes the requested transport. Used by `cli.fetch()` to short-circuit invocations with the `UNSUPPORTED_SURFACE` error code; extensions such as `@liche/mcp-server` use the same predicate to filter listings and reject calls. |
| `parseSchema`, `parseSchemaAsync` | Schema-boundary parse helpers that funnel errors through `normalizeZodError` into `ValidationError`. Use `parseSchemaAsync` when the schema may contain async codecs, transforms, or refinements (e.g. `arg.fromString({ decode: async })`); use sync `parseSchema` for intentionally sync boundaries such as config-file merging and telemetry wire validation. |
| `Formatter` | Output formatter namespace and renderer registry utilities for handwritten CLIs. |
| `collectCommandContracts`, `manifest`, `manifestEnvelope`, `mcpToolName`, `selectCommand` | Serializable command reflection/projection helpers used by first-party extensions. |
| `ok`, `fail`, `commandError` | Object-first result/error factories for command-authored outcomes. |
| `secret` | Redaction primitive for values that should not stringify or inspect as raw secrets. |
| `serializeHttpOperationRequest`, `callHttpOperation` | Outbound HTTP operation transport primitives. |

### Types — public because authoring/runtime helpers expose them

`ArgDecodeContext`, `ArgIssue`, `Awaitable`, `CliInstance`, `CliEvent`, `CliEventType`, `CliEventTarget`, `CliEventSubscriber`, `CliEventRegistration`, `CliEventError`, `CliEventCommand`, `CliEventCompletion`, `CliEventSurface`, `CliExtension`, `CliHookRegistration`, `BeforeExecuteHook`, `BuiltInFormat`, `CommandContract`, `CommandError`, `CommandInput`, `CommandSurface`, `Cta`, `CtaBlock`, `DeclarativeCommand`, `DeclarativeCommandRunContext`, `DefineCliOptions`, `DispatchOptions`, `Example`, `FetchHandler`, `FieldError`, `FieldErrorSource`, `Format`, `GlobalFlags`, `GlobalInputDefinition`, `GlobalInputType`, `HelpCommand`, `HelpControlOptions`, `HelpField`, `HelpGlobal`, `HelpModel`, `HelpRenderContext`, `HelpRenderer`, `InferSchema`, `InputSourceBinding`, `InputSourceProvider`, `InputSourceProvenance`, `InputSourceResolveInput`, `MiddlewareContext`, `MiddlewareHandler`, `OptionValueSource`, `OutputControlsOptions`, `OutputPolicy`, `OutputRenderContext`, `OutputRenderer`, `OutputRenderStage`, `ParsedInvocation`, `ParsedInvocationContextPatch`, `ParseInvocationOptions`, `ParseInvocationResult`, `ParseWarning`, `ReflectionControlsOptions`, `ResolvedInputSource`, `Result`, `ResultMeta`, `RunContext`, `Schema`, `TerminalHandler`, `RunOptions`, `SkillDefinition`, `SourceInspector`, `StoredCodecSurface`, `SurfaceCheckResult`, `Usage`, `UsageObject`.

### Auth/session runtime types

`SecretString` remains a core redaction primitive because outbound transports and extensions both need a value that cannot accidentally reveal itself. Auth workflow types such as `AuthProviderRuntime`, `AuthCredential`, `ContextRuntime`, `TokenSourceSpec`, `AuthCommandRuntime`, `AuthIdentityProbeInput`, `EnvTokenSourceSpec`, `SessionTokenSourceSpec`, `OAuthDeviceRuntime`, and `IdentityRuntime` live in `@liche/auth`.

`InvocationKind` (the `'cli' | 'ci' | 'agent' | 'mcp'` discriminator) was moved out of core. It now lives in `@liche/auth` because auth is the only consumer that actually branches on the value.

Workflow helpers (`resolveAuth`, `resolveContext`, `applyAuth`, `credentialHttpAuth`, `createFileSessionStore`, `authWhoami`, `authSwitch`, `logoutAuthSession`, `oauthDeviceLogin`) live in `@liche/auth`, not core. Command-level auth metadata is a Product/adapter concern, not a core `CommandContract` field.

### HTTP transport types

`RuntimeValue`, `HttpAuth`, `HttpMethod`, `HttpFetch`, `HttpOperationBind`, `HttpOperationRequestSpec`, `SerializedHttpRequest`, `HttpOperationCall`, `RemoteErrorDetails`.

### Input-source primitive

Core owns a generic command input assembly phase before schema validation. Extensions register `CliExtension.inputSources`; commands bind options through `input.sources.options`; handlers inspect source values and provenance through `RunContext.sources`. The config extension is one provider on that primitive, not a Core-owned config system.

Runtime guarantees:

- Explicit argv values beat external providers.
- Bound input sources resolve in declaration order.
- Schema defaults apply only after argv and external source values are assembled.
- Providers return raw values; Core performs option-schema-aware primitive coercion during the merge step.
- Option provenance distinguishes argv, provider, and schema-default values.
- Config-specific behavior such as `--config`, `--no-config`, file discovery, and file formats belongs to `@liche/config`.

### Output-renderer primitive

Core owns a generic final-value rendering phase after command execution and output validation. Extensions register `CliExtension.outputRenderers`; `outputControls({ format: true, formats: [...] })` decides which renderer names are accepted by `--format`. The `--json` control selects the `json` renderer, so JSON uses the same registry path as every other output format.

Runtime guarantees:

- `json` is the default built-in output renderer.
- `json`, `jsonl`, `yaml`, `md`, and `csv` are first-party built-in renderers.
- Custom renderers receive only the final value and an `OutputRenderContext`; they do not parse argv, load config, mutate command inputs, or own result-envelope selection.
- Duplicate custom renderer names fail during CLI creation. A custom renderer may deliberately replace a built-in renderer name, including `json`.
- Installing a renderer does not install a global flag. The CLI still opts into `--json` and `--format` through `outputControls()`.

### Result envelope

`Result` is a stable machine envelope:

- Success: `{ ok: true, data, error: null, meta? }`.
- Failure: `{ ok: false, data: null, error, meta? }`.

Runtime-owned producers (`ctx.ok`, `ctx.error`, output validation, fetch-backed commands, `cli.fetch()`, and generated envelope mode) populate the null branch explicitly. Non-human command failures serialize the full envelope even for handwritten CLIs. Handwritten success output remains bare under `--json` unless the caller requests `--full-output` or the CLI opts into `generated.machineOutput: 'envelope'`.

Executor control results are factory-branded, not structurally detected. Command handlers that finish early return `ctx.ok(...)`, `ctx.error(...)`, `ok(...)`, or `fail(...)`. Full result-shaped objects from arbitrary domain data are not treated as control results.

### Structured recovery errors

`CommandError` carries RFC-9457-shaped Problem Details fields (`type`, `title`, `status`, `detail`, `instance`) and agent recovery extensions (`retry_after`, `suggested_fix`, `code_actions`). The `message`, `code`, `details`, `fieldErrors`, `hint`, `retryable`, and `exitCode` fields support CLI compatibility. `RunContext.error(...)` accepts the full `CommandError` shape plus optional CTA metadata and returns a branded failure `Result`.

## Internal-only

The following are source-path internals. White-box tests may import them from source subpaths; generated code and external consumers do not.

### Internal namespaces (not exported from package root)

- `Errors` — typed error classes (`BaseError`, `LicheError`, `ParseError`, `ValidationError`, `toCommandError`). Public command code uses `ok` / `fail` / `commandError`.
- `Help` — state-shaped help renderer.
- `Parser` — argv/env/config parsers.
- `Filter` — formatter filter helpers; `Formatter.pick` is the public path.
- `Completions` — completion engine; reach through `run(cli)` or `cli.fetch()`.
- `Fetch` — in-process fetch-command internals. Outbound remote transport is `serializeHttpOperationRequest` and `callHttpOperation`.
- MCP server execution lives in `@liche/mcp-server`; core exposes only command reflection helpers such as `mcpToolName`.
- `Schema` namespace — Zod adapter internals. `z` is the public path; `Schema` is reserved as a public type name.
- `Skill` — skill helpers; use `DefineCliOptions.skill` or `CliInstance` accessors.

### Internal source-path imports

- `stateSymbol`, `InternalCli`, `formatHumanValidationError`
- `SelectedCommand`, `CliState`, `Entry`, `FetchEntry`, `GroupEntry`, `AliasEntry`
- `renderHelp`
- `commandScope`, `childCommands`, `completionCommands`, `outputPolicy`
- command guards
- `builtinHelpLines`, `builtinSuggestions`
- helpers from `packages/core/src/internal.ts`
- `handleMcpHttp`
- parser/config functions from `packages/core/src/parser/*`
- Zod adapter helpers from `packages/core/src/schema/zod.ts`

Promoting any private helper to public requires a package-root consumer fixture or an extension-lane test that cannot be written through the existing public APIs.

## Decision rule for future widening

Future public-surface widening follows this order:

1. Try to implement the feature as an extension using package-root APIs, lifecycle events, hooks, middleware, input sources, command contracts, Product catalog artifacts, generated OpenAPI, or release/build records.
2. If that works, keep it outside core and add a disabled-state test.
3. If it fails because the extension must import internals, mutate hidden runtime state, eagerly import implementation modules, or duplicate parser/executor/security/provenance behavior, add a failing extension-lane test that demonstrates the missing reusable lane.
4. Widen core only by adding that reusable lane. One-off helper commands are not a widening.

The boundary decision does not start with "core or plugin?" It starts with "which stable contract does this consume, and does the extension-lane test pass?"

## Categories of valid core widening

When core has to widen, the widening falls into one of four categories. Anything outside these categories is an extension lane:

- **Extension lane gap** — an optional feature cannot be implemented without importing internals. Resolution: add a reusable lane such as lifecycle events, hooks, middleware, or extension composition.
- **Generated-runtime primitive** — generated CLIs cannot preserve command semantics without core support. Resolution: add a shared primitive (envelope mode, auth/session, HTTP transport, input-source provenance).
- **Metadata or envelope fields** — an existing serializable contract needs richer metadata for agents/MCP/manifests. Resolution: enrich `CommandContract`, `Result`, or MCP projection.
- **Public surface cleanup** — the root exposes implementation details that generated code is about to depend on. Resolution: shrink the surface and lock the result with a snapshot.

Anything else stays out of core.

# Core API boundary freeze

This records the Phase 2 decision for `packages/core/src/index.ts` before generated code in `@lili/product` starts importing `@lili/core`.

## Declarative authoring re-freeze

The first hard-cutover slice for the declarative core direction has shipped. The public handwritten authoring surface is now data-first:

- `defineCommand({ path, aliases, input, output, safety, run })` declares the analyzable command surface before pairing it with a handler.
- `defineCli({ name, version, commands })` mounts those command objects into the existing runtime executor.
- `CommandInput`, `CommandSafety`, `DeclarativeCommand`, `DeclarativeCommandRunContext`, and `DefineCliOptions` are public because the helpers expose them.
- `CommandContract.path`, `CommandContract.summary`, and `CommandContract.safety` are public serializable metadata used by manifest and MCP projection.

The hard cutover removes the fluent command builder from the public API. New handwritten examples, generated CLI output, and package-consumer tests must use `defineCli()` and `defineCommand()`.

Direct core MCP projection now uses the same command contract boundary for both input and output metadata. `tools/list` wraps declared args/options as the MCP input schema, includes a command `outputSchema` when the command declares output, and derives MCP hint annotations from `CommandSafety`, `CommandEffects`, and `CommandPolicy`.

## Phase 3 re-freeze (packaged skills)

Deliberate, narrow widening to let tool CLIs ship authored agent guidance without making generated product CLI surfaces depend on core reflection:

- `DefineCliOptions.skill?: { markdown?: string; index?: string }` lets a CLI provide packaged skill content for `--llms` and opt-in skill installers. If `markdown` is omitted, core keeps the reflection-generated skill body. Client-specific install paths must stay adapter-bound rather than becoming required core behavior.
- New public type `SkillDefinition`.

## V1 supportability re-freeze (lifecycle events and hooks)

Deliberate, narrow widening for local observability and framework extension:

- `DefineCliOptions.events` declares observe-only lifecycle subscribers.
- `DefineCliOptions.hooks` declares typed mutation hooks.
- `DefineCliOptions.middleware` declares around-command middleware at construction time.
- New public types: `CliEvent`, `CliEventType`, `CliEventTarget`, `CliEventSubscriber`, `CliEventRegistration`, `CliEventError`, `CliEventCommand`, `CliEventCompletion`, `CliEventMcp`, `CliEventSurface`, `CliHookRegistration`, and `BeforeExecuteHook`.

The public guarantee is the lane split, not a hosted telemetry product: event subscribers receive redacted snapshots and cannot affect command results; hooks are explicit mutation points and may fail commands.

Lifecycle events intentionally cover more local surfaces than telemetry exports: command execution, validation, parse failures, help/version/completion/schema rendering, MCP initialize/list/call, not-found, and hook failure. Hosted or file telemetry must consume an explicit allowlist rather than forwarding every event.

## Phase 3 re-freeze (Commit 3)

Deliberate, narrow widening to support generated CLIs:

- `ResultMeta` widened to `Record<string, unknown> & { cta?: CtaBlock }`. Arbitrary meta keys round-trip through `ctx.ok(data, meta)` to the result envelope.
- `RunContext.ok` signature now accepts `meta?: ResultMeta` (was `meta?: { cta?: CtaBlock }`).
- `DefineCliOptions.generated?: { machineOutput: 'envelope'; disabledGlobals?: readonly DisabledGlobal[] }` opts a CLI into envelope output under `--json` and global-flag rejection.
- `DefineCliOptions.builtins?: { completions?: boolean; mcp?: boolean; skills?: boolean }` lets CLIs opt into helper built-ins. `completions` defaults on; `mcp` and `skills` default off. `config doctor` is exposed when config is declared unless explicitly disabled.
- New public type `DisabledGlobal` (currently `'format'`).

## Result envelope hard cutover

`Result` is now a stable machine envelope, not a discriminated pair with missing branches:

- Success: `{ ok: true, data, error: null, meta? }`.
- Failure: `{ ok: false, data: null, error, meta? }`.

Runtime-owned producers (`ctx.ok`, `ctx.error`, output validation, fetch-backed commands, `cli.fetch()`, generated envelope mode, and write-side helper built-ins) must populate the null branch explicitly. Non-human command failures serialize the full envelope even for handwritten CLIs, so agents and scripts can always find `error` without guessing whether stdout is a bare error object. Handwritten success output remains bare under `--json` unless the caller requests `--full-output` or the CLI opts into `generated.machineOutput: 'envelope'`.

Executor control results are factory-branded, not structurally detected. Command handlers that want to finish early must return `ctx.ok(...)`, `ctx.error(...)`, `ok(...)`, or `fail(...)`; otherwise even full result-shaped objects are treated as ordinary domain data.

The error-handling policy in `docs/error-handling.md` is now implemented: command-authored outcomes return standardized `ok(...)` / `fail(commandError(...))` results, while typed thrown errors stay internal to parser/schema/auth/HTTP plumbing and are normalized once by the executor.

## Object-first error factory cutover

The package-root error authoring surface is object-first:

- `ok(data?, meta?)` returns a branded success `Result`.
- `fail(error, meta?)` returns a branded failure `Result` and lifts `cta` into `meta.cta`.
- `commandError(input)` normalizes a `CommandError` object with Problem Details defaults.

`RunContext.ok()` and `RunContext.error()` now return these branded results instead of throwing a hidden executor sentinel. `BeforeExecuteHook` may also return a branded `Result` to short-circuit through the same lifecycle path. The executor removed the old `Done` sentinel and accepts only branded results as control results.

`BaseError`, `LiliError`, `ParseError`, `ValidationError`, and `toCommandError()` are internal source-path implementation details. They remain available to parser/schema/auth/HTTP internals and white-box tests, but are no longer exported from `@lili/core`.

Out of scope: `ctx.sources.options` (per-option provenance). Locality source values are restricted to `"flag" | "schema-default"` until core carries option provenance — that's a separate change with its own re-freeze.

## Auth/session re-freeze target

When the auth/session slice lands, `@lili/core` deliberately widens again to support generated and handwritten remote-operation CLIs. The planned top-level public additions are:

- `secret(value)` and `SecretString` — redaction boundary for token material. Stringification and JSON serialization must redact; only transport/session code may reveal.
- `resolveAuth(input)` — async credential resolution over env and, in later slices, stored sessions.
- `resolveContext(input)` — async context resolution over explicit flags/input, env, and allowed stored profile context.
- `SessionStore` and `createFileSessionStore(options?)` — public session/profile storage interface and default file-backed implementation.
- `applyAuth(headers, credential)` — transport-facing helper that mutates headers from a resolved credential.
- Auth runtime types: `TokenSourceSpec`, `AuthProviderRuntime`, `AuthCredential`, `InvocationKind`, `ContextRuntime`, and `StoredProfile`.

Generated auth-enabled CLIs may also require global generated flags `--profile`, `--non-interactive`, and `--no-session`. Those flags are generated CLI behavior, not handwritten core defaults.

This re-freeze does not make auth a separate package. The authoritative behavior and MVP staging live in `docs/auth-session.md`.

### Phase 3D-A landed (env-only auth)

The first staged slice from `docs/next-plan.md` has shipped. The following are now real public exports of `@lili/core`, locked by `packages/core/test/api-snapshot.test.ts` and the package-consumer boundary test in `packages/product/test/core-consumer-boundary.test.ts`:

- Values: `secret`, `resolveAuth`, `resolveContext`, `applyAuth`.
- Types: `SecretString`, `AuthProviderRuntime`, `AuthCredential`, `ContextRuntime`, `InvocationKind`, `TokenSourceSpec`, `CommandAuthMetadata`.

Deferred to 3D-B / 3D-C / later Phase 4 slices at the time of 3D-A: `SessionStore`, `createFileSessionStore`, `StoredProfile`, `--profile` / `--non-interactive` / `--no-session` global flags, `Auth.token.session`, OAuth device flow, identity endpoint resolution, and resolved account/session status metadata.

`RunContext` gained `invocation: 'cli' | 'ci' | 'agent' | 'mcp'` so generated command code can pass the real invocation posture into `resolveAuth`. Plain CLI invocations infer `ci` from common CI env vars; MCP and fetch-backed agent calls pass `mcp` / `agent` explicitly.

Internal `LiliError` gained a structured `details: Record<string, unknown>` slot (with `BaseError.details` widened to `string | Record<string, unknown> | undefined` so the override is type-safe) and `CommandError` gained the matching optional `details` field. `toCommandError` propagates it behind the executor boundary. `AUTH_*` error factories (`authMissing`, `authCiTokenMissing`, `authContextRequired`, `authScopeMissing`, `authPermissionDenied`, `authInvalid`, `authExpired`) stay package-internal and are not part of the frozen surface; public command code should emit `CommandError` objects through `ctx.error(...)` / `fail(...)`.

### Agent recovery error widening landed

`CommandError` now also carries RFC-9457-shaped Problem Details fields (`type`, `title`, `status`, `detail`, `instance`) and agent recovery extensions (`retry_after`, `suggested_fix`, `code_actions`). The existing `message`, `code`, `details`, `fieldErrors`, `hint`, `retryable`, and `exitCode` fields remain for CLI compatibility. `RunContext.error(...)` accepts the full `CommandError` shape plus optional CTA metadata and returns a branded failure `Result`, so generated and handwritten commands can emit structured recovery actions without throwing a separate error class.

### Phase 3D-B/C landed (sessions, generated auth commands, OAuth device)

The session and OAuth slices from `docs/auth-session.md` have shipped. The following are now real public exports of `@lili/core`, locked by `packages/core/test/api-snapshot.test.ts` and the package-consumer boundary test in `packages/product/test/core-consumer-boundary.test.ts`:

- Values: `createFileSessionStore`, `authWhoami`, `authSwitch`, `logoutAuthSession`, `oauthDeviceLogin`.
- Types: `SessionStore`, `StoredProfile`, `AuthCommandRuntime`, `AuthGlobalOptions`, `AuthIdentityProbeInput`, `AuthRuntimeInput`, `EnvTokenSourceSpec`, `SessionTokenSourceSpec`, `OAuthDeviceRuntime`, `IdentityRuntime`, `FileSessionStoreOptions`, and `GlobalOptions`.

`RunContext` now carries `global: { profile?, nonInteractive?, noSession? }` and `isTty` so generated auth commands can distinguish explicit login from CI/agent/MCP/noninteractive calls. Core parses `--profile`, `--non-interactive`, and `--no-session` as generated-global inputs; normal commands still call `resolveAuth` and never start OAuth device login implicitly.

The file session store is intentionally plaintext JSON with restricted permissions for MVP. It supports profiles, active profile selection, selected context storage, access-token persistence, corrupt-file quarantine, and lock-timeout errors. Refresh tokens and keychain storage stay deferred.

### Phase 4-A landed (core HTTP transport)

The first outbound remote transport slice has shipped. The following are now real public exports of `@lili/core`, locked by `packages/core/test/api-snapshot.test.ts` and the package-consumer boundary test in `packages/product/test/core-consumer-boundary.test.ts`:

- Values: `serializeHttpOperationRequest`, `callHttpOperation`.
- Types: `RuntimeValue`, `HttpAuth`, `HttpMethod`, `HttpFetch`, `HttpOperationBind`, `HttpOperationRequestSpec`, `SerializedHttpRequest`, `HttpOperationCall`, `RemoteErrorDetails`.

This slice covers pure request serialization, env/literal base URL resolution, env or resolved auth application, timeout/network/status/response/schema error normalization, and output validation. The later Product config/base URL slice completed the generated wiring: generated `remote-http` and resource-operation commands now call `callHttpOperation` when `remote.baseUrl` is declared, and generation fails for HTTP-backed capabilities without that declaration.

## Config primitive re-freeze (landed)

The deliberate widening for generated remote wiring has shipped as the first-class config primitive described in `docs/config-primitive.md`.

Top-level public additions:

- `createConfig(...)` — public declaration helper for opt-in typed config.
- Config declaration and provenance types exposed by `DefineCliOptions.config`, `RunContext.config`, and `RunContext.sources`.
- Explicit option-to-config bindings so config never satisfies command options by automatic name matching.

Runtime guarantees:

- A CLI without a config declaration rejects `--config` and `--no-config`.
- `--config <path>` loads exactly that file and disables discovery.
- `--no-config` disables project and user discovery.
- Project/user config, session/profile defaults, option env defaults, argv, and schema defaults keep distinct provenance.

This re-freeze replaced the low-level loader-shaped config compatibility hook with a declarative public contract on `DefineCliOptions`. Parser/config helpers stay internal implementation details; generated code and downstream handwritten CLIs should import only top-level `@lili/core` APIs.

Public means importable from `@lili/core`. Tests may keep importing subpaths for white-box coverage, but those imports do not define the package API. The package export map exposes only `"."`, so no generated code or downstream package should depend on `packages/core/src/*` subpaths.

## Freeze rules

- New handwritten CLI code declares commands through `defineCli()` / `defineCommand()` and uses core runtime behavior through documented top-level APIs only.
- Generated CLI code declares through `defineCli()` / `defineCommand()` and must not depend on internal registry state.
- Generated code must not import `stateSymbol`, `InternalCli`, `CliState`, parser helpers, command registry helpers, command guards, help renderers, or schema-adapter internals.
- Runtime reflection in core is backed by serializable `CommandContract` records, not raw `Entry` / `CliState` inspection. Product-generated OpenAPI, MCP, docs, Agent Skill, and command manifest surfaces still belong to `@lili/product` when the Product catalog is the source of truth.
- Remove or reshape current index exports before freezing. Do not keep duplicate or state-shaped exports just because tests currently reach them.
- Widen the public surface only when an extension cannot be implemented through public lanes without importing internals, mutating hidden runtime state, eagerly importing implementation modules, or duplicating parser/executor/security/provenance behavior. The widening must add a reusable lane, not a one-off helper.

`packages/core/test/extension-lane-coverage.test.ts` is the mechanical check for that last rule. It builds representative optional features using only package-root imports: a command-registration/config-provenance extension, an observe-only lifecycle subscriber, and a non-interactive policy hook. The fixture also proves disabled extensions leave baseline command output unchanged. A future core widening should first add or update a failing extension-lane case that demonstrates the missing public lane.

## Keep public

- `defineCli` — canonical handwritten CLI authoring helper for data-first command graphs.
- `defineCommand` — canonical command declaration helper for analyzable command metadata plus a handler.
- `middleware` (`packages/core/src/cli/context.ts:3`) — imported by `contract.test.ts` and `parity.test.ts`; docs name middleware as core behavior.
- `z` (`packages/core/src/schema/zod.ts:5`) — imported by many core tests and used in docs examples; public schema authoring convenience.
- `Formatter` (`packages/core/src/format/index.ts:1`) — imported by `contract.test.ts`, `formatter-default.test.ts`, and `behavior-edges.test.ts`; docs require formatter/output envelope behavior.
- `ok`, `fail`, and `commandError` (`packages/core/src/errors/error.ts`) — public object-first result/error factories for command-authored outcomes.
- `Awaitable` (`packages/core/src/types.ts:4`) — keep only because public callback types name it.
- `BuiltinsConfig` (`packages/core/src/types.ts:121`) — public because `DefineCliOptions.builtins` exposes it.
- `CliInstance` (`packages/core/src/types.ts:203`) — public return type for `defineCli()`.
- `CliEvent`, `CliEventType`, `CliEventTarget`, `CliEventSubscriber`, `CliEventRegistration`, `CliEventError`, `CliEventCommand`, `CliEventCompletion`, `CliEventMcp`, and `CliEventSurface` — public because `DefineCliOptions.events` exposes the observe-only lifecycle event contract.
- `CliHookRegistration` and `BeforeExecuteHook` — public because `DefineCliOptions.hooks` exposes typed mutation points.
- `CommandContract` — public serializable command metadata contract for manifest/schema/help/MCP projections. It must not expose `Entry`, `CliState`, handlers, or runtime registry handles.
- `CommandEffectKind`, `CommandEffects`, and `CommandPolicy` — public because `DeclarativeCommand` and `CommandContract` expose safety metadata for command manifests and MCP annotations.
- `CommandInput`, `CommandSafety`, `DeclarativeCommand`, `DeclarativeCommandRunContext`, and `DefineCliOptions` — public because `defineCli()` / `defineCommand()` expose the declarative authoring contract.
- `Cta` (`packages/core/src/types.ts:10`) — public CTA metadata used by result envelopes.
- `CtaBlock` (`packages/core/src/types.ts:19`) — public CTA metadata used by `ctx.ok()` and `ctx.error()`.
- `Example` (`packages/core/src/types.ts:99`) — public command help/docs metadata.
- `FetchHandler` (`packages/core/src/types.ts:98`) — referenced by `docs/invariant.md`; public in-process fetch-backed command bridge.
- `Format` (`packages/core/src/types.ts:5`) — public formatter/global flag vocabulary.
- `MiddlewareContext` (`packages/core/src/types.ts:92`) — public because `MiddlewareHandler` exposes it.
- `MiddlewareHandler` (`packages/core/src/types.ts:93`) — public middleware authoring type.
- `OutputPolicy` (`packages/core/src/types.ts:6`) — command definition/output envelope contract.
- `Result` (`packages/core/src/types.ts:47`) — public execution envelope type after its helper types are exported.
- `RunContext` (`packages/core/src/types.ts:70`) — public command handler context type.
- `SkillDefinition` (`packages/core/src/types.ts`) — public because `DefineCliOptions.skill` exposes it.
- `Schema` (`packages/core/src/types.ts:7`) — export under this exact type name before freeze; current `ZodSchema` alias does not match public signatures.
- `ServeOptions` (`packages/core/src/types.ts:194`) — imported through index by `helpers.ts`; public `.serve()` configuration.
- `Usage` (`packages/core/src/types.ts:106`) — public help metadata.
- `UsageObject` (`packages/core/src/types.ts:100`) — public help metadata.

Also export `CommandError` (`packages/core/src/types.ts:33`), `FieldError` (`packages/core/src/types.ts:24`), `InferSchema` (`packages/core/src/types.ts:8`), and `ResultMeta` (`packages/core/src/types.ts:43`) because public types otherwise reference unexported helpers.

The auth/session additions above are now part of the keep-public list and are guarded by both source-local and package-consumer API snapshot tests.

The config primitive additions above are now part of the keep-public list and are guarded by implementation tests plus the package API snapshot.

## Internalized Before V1

The public-surface minimization pass after `docs/research/public-surface-audit.md` removed these weakly justified root exports from `@lili/core`.

Deleted because they were test-only auth metadata mirrors with no generated-code, extension-lane, or package-root consumer:

- `authMetaFromCredential`
- `ResolvedAuthMeta`

Kept only as private implementation helpers because production core code still uses the behavior:

- `defaultSessionRoot`
- `isValidProfileName`
- `probeIdentity`
- `redactTelemetryValue`

Moved from package-root API to source-path internals because public command code now uses the object factories and machine envelopes:

- `BaseError`
- `LiliError`
- `ParseError`
- `ValidationError`
- `toCommandError`

Re-promoting any private helper now requires a package-root consumer fixture or an extension-lane test that cannot be written through the remaining public APIs. Recreating deleted auth metadata needs stronger evidence than white-box tests because generated manifests and MCP projections already carry non-secret auth metadata.

## Mark internal

- `Errors` (`packages/core/src/errors/index.ts:1`) — no test imports the namespace from index. Keep typed error classes and `toCommandError` internal; expose only `ok`, `fail`, and `commandError` from the package root.
- `Help` (`packages/core/src/help/index.ts:1`) — direct tests cover `renderHelp`, but the signature requires `CliState`; do not expose the state-shaped renderer.
- `Parser` (`packages/core/src/parser/index.ts:1`) — `behavior-edges.test.ts` imports it through index, but generated code should not parse argv itself. Parser/config/env validation is core behavior, not a public helper namespace.
- `Filter` (`packages/core/src/format/filter.ts:3`) — no direct index test import; `Formatter.pick` is enough.
- `Dict` (`packages/core/src/types.ts:3`) — replace uses in public types with explicit `Record<string, unknown>` or narrower public records, then stop exporting it.

## Remove from the public index

- `default` (`packages/core/src/cli/context.ts:7`) — no test, docs, or source caller; delete this default export before freeze.
- legacy builder types such as `CommandDefinition` and `CreateOptions` — internal normalized runtime shapes only; they are not exported from `@lili/core`.

## Rename or reshape

- `Completions` (`packages/core/src/completions/index.ts:1`) — `contract.test.ts` imports `Completions.complete`, but current helpers take `CliState`. Either keep completions as built-in CLI behavior only or expose a wrapper that accepts `CliInstance`.
- `Fetch` (`packages/core/src/fetch/index.ts:1`) — `behavior-edges.test.ts` covers `parseCurl` and `callFetch`, but these are in-process fetch-command internals. The public outbound remote surface is `serializeHttpOperationRequest` and `callHttpOperation`; do not expose these fetch-command internals as a transport API.
- `Mcp` (`packages/core/src/mcp/index.ts:1`) — tests import it through index, and docs require MCP basics, but current functions take `CliState`. Public MCP helpers must accept `CliInstance` or be reachable through `cli.fetch()`/`cli.serve()`.
- `Schema` namespace (`packages/core/src/schema/index.ts:1`) — `behavior-edges.test.ts` imports it through index, but helpers such as `objectShape`, `kind`, and `parseSchema` expose the Zod adapter internals. Keep `z` public and reserve the `Schema` name for the public type.
- `Skill` (`packages/core/src/skills/index.ts:1`) — tests import it through index and docs name skill/docs helpers, but current functions take `CliState`. Public helpers must accept `CliInstance` or a documented manifest, not internal state.
- `ZodSchema` (`packages/core/src/types.ts:7` via index alias) — replace with `Schema`; do not freeze this alias.

## Test-only internal imports

These imports are not promotion candidates:

- `stateSymbol` and `InternalCli` from `packages/core/src/cli/create.ts`
- `formatHumanValidationError` from `packages/core/src/cli/format-error.ts`
- `SelectedCommand`, `CliState`, `Entry`, `FetchEntry`, `GroupEntry`, and `AliasEntry` from `packages/core/src/types.ts`
- `renderHelp` from `packages/core/src/help/render.ts`
- `manifestEnvelope`, `mcpToolName`, `selectCommand`, `commandScope`, `childCommands`, `completionCommands`, `outputPolicy`, and `collectCommandContracts` from `packages/core/src/command/registry.ts`
- command guards from `packages/core/src/command/guards.ts`
- `builtinHelpLines` and `builtinSuggestions` from `packages/core/src/cli/builtin-metadata.ts`
- helpers from `packages/core/src/internal.ts`
- `handleMcpHttp` from `packages/core/src/mcp/http.ts`
- parser/config functions from `packages/core/src/parser/*`
- Zod adapter helpers from `packages/core/src/schema/zod.ts`

White-box tests can keep using these while the source tree is tested directly. Package and generated-code boundary tests should prove no consumer imports them from `@lili/core`.

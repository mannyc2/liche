# Core API boundary freeze

This records the Phase 2 decision for `packages/core/src/index.ts` before generated code in `@lili/build` starts importing `@lili/core`.

## Phase 3 re-freeze (packaged skills)

Deliberate, narrow widening to let tool CLIs ship authored agent guidance without making generated product CLI surfaces depend on core reflection:

- `CreateOptions.skill?: { markdown?: string; index?: string }` lets a CLI provide packaged skill content for `skills add` and `--llms`. If `markdown` is omitted, core keeps the reflection-generated skill body.
- New public type `SkillDefinition`.

## Phase 3 re-freeze (Commit 3)

Deliberate, narrow widening to support generated CLIs:

- `ResultMeta` widened to `Record<string, unknown> & { cta?: CtaBlock }`. Arbitrary meta keys round-trip through `ctx.ok(data, meta)` to the result envelope.
- `RunContext.ok` signature now accepts `meta?: ResultMeta` (was `meta?: { cta?: CtaBlock }`).
- `CreateOptions.generated?: { machineOutput: 'envelope'; disabledGlobals?: readonly DisabledGlobal[] }` opts a CLI into envelope output under `--json` and global-flag rejection.
- `CreateOptions.builtins?: { completions?: boolean; gen?: boolean; mcp?: boolean; skills?: boolean }` lets CLIs opt into helper built-ins. `completions` defaults on; `gen`, `mcp`, and `skills` default off.
- New public type `DisabledGlobal` (currently `'format'`).

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

The first staged slice from `docs/next-plan.md` has shipped. The following are now real public exports of `@lili/core`, locked by `packages/core/test/api-snapshot.test.ts` and the package-consumer boundary test in `packages/build/test/core-consumer-boundary.test.ts`:

- Values: `secret`, `resolveAuth`, `resolveContext`, `applyAuth`, `authMetaFromCredential`.
- Types: `SecretString`, `AuthProviderRuntime`, `AuthCredential`, `ContextRuntime`, `InvocationKind`, `TokenSourceSpec`, `ResolvedAuthMeta`, `CommandAuthMetadata`.

Deferred to 3D-B / 3D-C / Phase 4: `SessionStore`, `createFileSessionStore`, `StoredProfile`, `--profile` / `--non-interactive` / `--no-session` global flags, `Auth.token.session`, OAuth device flow, identity endpoint resolution, resolved account/session status metadata, `serializeHttpOperationRequest` / `callHttpOperation`.

`RunContext` gained `invocation: 'cli' | 'ci' | 'agent' | 'mcp'` so generated command code can pass the real invocation posture into `resolveAuth`. Plain CLI invocations infer `ci` from common CI env vars; MCP and fetch-backed agent calls pass `mcp` / `agent` explicitly.

`LiliError` gained a structured `details: Record<string, unknown>` slot (with `BaseError.details` widened to `string | Record<string, unknown> | undefined` so the override is type-safe) and `CommandError` envelope gained the matching optional `details` field. `errorToObject` propagates it. `AUTH_*` error factories (`authMissing`, `authCiTokenMissing`, `authContextRequired`, `authScopeMissing`, `authPermissionDenied`, `authInvalid`, `authExpired`) stay package-internal and are not part of the frozen surface — callers catch them as `LiliError` instances with `code: 'AUTH_*'`.

Public means importable from `@lili/core`. Tests may keep importing subpaths for white-box coverage, but those imports do not define the package API. The package export map exposes only `"."`, so no generated code or downstream package should depend on `packages/core/src/*` subpaths.

## Freeze rules

- Generated CLI code registers through `Cli.create().command()` and uses core runtime behavior through documented top-level APIs only.
- Generated code must not import `stateSymbol`, `InternalCli`, `CliState`, parser helpers, command registry helpers, command guards, help renderers, or schema-adapter internals.
- Runtime reflection in core remains a handwritten-CLI compatibility surface. Schema-generated OpenAPI, MCP, docs, Agent Skill, and command manifest surfaces belong to `@lili/build`.
- Remove or reshape current index exports before freezing. Do not keep duplicate or state-shaped exports just because tests currently reach them.

## Keep public

- `Cli` (`packages/core/src/cli/create.ts:65`) — imported by core tests; referenced by `docs/behavior-plan.md`, `docs/next-plan.md`, `docs/package-layout.md`, `docs/build-system.md`, and `docs/invariant.md`; this is the generated CLI entrypoint.
- `middleware` (`packages/core/src/cli/context.ts:3`) — imported by `contract.test.ts` and `parity.test.ts`; docs name middleware as core behavior.
- `z` (`packages/core/src/schema/zod.ts:5`) — imported by many core tests and used in docs examples; public schema authoring convenience.
- `Formatter` (`packages/core/src/format/index.ts:1`) — imported by `contract.test.ts`, `toon-oracle.test.ts`, and `behavior-edges.test.ts`; docs require formatter/output envelope behavior.
- `BaseError` (`packages/core/src/errors/error.ts:3`) — direct error test coverage; public base class for structured core errors.
- `LiliError` (`packages/core/src/errors/error.ts:25`) — direct error test coverage and docs/log references; user-thrown structured error type.
- `ParseError` (`packages/core/src/errors/error.ts:70`) — imported through index by `parser-config.test.ts`; public parse failure type.
- `ValidationError` (`packages/core/src/errors/error.ts:52`) — direct schema/error test coverage; public validation failure type.
- `Awaitable` (`packages/core/src/types.ts:4`) — keep only because public callback types name it.
- `BuiltinsConfig` (`packages/core/src/types.ts:121`) — public because `CreateOptions.builtins` exposes it.
- `CliInstance` (`packages/core/src/types.ts:203`) — imported through index by `helpers.ts`; public return type for `Cli.create()`.
- `CommandDefinition` (`packages/core/src/types.ts:108`) — public `.command()` input type.
- `CreateOptions` (`packages/core/src/types.ts:138`) — must be exported because `Cli.create()` signatures expose it.
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
- `SkillDefinition` (`packages/core/src/types.ts`) — public because `CreateOptions.skill` exposes it.
- `Schema` (`packages/core/src/types.ts:7`) — export under this exact type name before freeze; current `ZodSchema` alias does not match public signatures.
- `ServeOptions` (`packages/core/src/types.ts:194`) — imported through index by `helpers.ts`; public `.serve()` configuration.
- `Usage` (`packages/core/src/types.ts:106`) — public help metadata.
- `UsageObject` (`packages/core/src/types.ts:100`) — public help metadata.

Also export `CommandError` (`packages/core/src/types.ts:33`), `FieldError` (`packages/core/src/types.ts:24`), `InferSchema` (`packages/core/src/types.ts:8`), and `ResultMeta` (`packages/core/src/types.ts:43`) because public types otherwise reference unexported helpers.

The auth/session additions above join this keep-public list only when their implementation and API snapshot tests land. Until then they are planned public surface, not current exports.

## Mark internal

- `Errors` (`packages/core/src/errors/index.ts:1`) — no test imports the namespace from index. Keep top-level error classes public; keep `errorToObject` internal.
- `Help` (`packages/core/src/help/index.ts:1`) — direct tests cover `renderHelp`, but the signature requires `CliState`; do not expose the state-shaped renderer.
- `Parser` (`packages/core/src/parser/index.ts:1`) — `behavior-edges.test.ts` imports it through index, but generated code should not parse argv itself. Parser/config/env validation is core behavior, not a public helper namespace.
- `Filter` (`packages/core/src/format/filter.ts:3`) — no direct index test import; `Formatter.pick` is enough.
- `Dict` (`packages/core/src/types.ts:3`) — replace uses in public types with explicit `Record<string, unknown>` or narrower public records, then stop exporting it.

## Remove from the public index

- `default` (`packages/core/src/cli/context.ts:7`) — no test, docs, or source caller; delete this default export before freeze.
- `create` (`packages/core/src/cli/create.ts:18`) — keep the implementation for `Cli.create`, but do not freeze a duplicate top-level `create()` API.

## Rename or reshape

- `Completions` (`packages/core/src/completions/index.ts:1`) — `contract.test.ts` imports `Completions.complete`, but current helpers take `CliState`. Either keep completions as built-in CLI behavior only or expose a wrapper that accepts `CliInstance`.
- `Fetch` (`packages/core/src/fetch/index.ts:1`) — `behavior-edges.test.ts` covers `parseCurl` and `callFetch`, but these are in-process fetch-command internals. The public remote surface must be the documented `serializeHttpOperationRequest` and `callHttpOperation` primitives when implemented.
- `Mcp` (`packages/core/src/mcp/index.ts:1`) — tests import it through index, and docs require MCP basics, but current functions take `CliState`. Public MCP helpers must accept `CliInstance` or be reachable through `cli.fetch()`/`cli.serve()`.
- `Schema` namespace (`packages/core/src/schema/index.ts:1`) — `behavior-edges.test.ts` imports it through index, but helpers such as `objectShape`, `kind`, and `parseSchema` expose the Zod adapter internals. Keep `z` public and reserve the `Schema` name for the public type.
- `Skill` (`packages/core/src/skills/index.ts:1`) — tests import it through index and docs name skill/docs helpers, but current functions take `CliState`. Public helpers must accept `CliInstance` or a documented manifest, not internal state.
- `Typegen` (`packages/core/src/command/registry.ts:5`) — the current namespace is actually command registry reflection, not type generation. Remove it from core's public index. `li gen` remains temporary runtime behavior until `@lili/build` owns typegen, as noted in `docs/build-system.md`.
- `ZodSchema` (`packages/core/src/types.ts:7` via index alias) — replace with `Schema`; do not freeze this alias.

## Test-only internal imports

These imports are not promotion candidates:

- `stateSymbol` and `InternalCli` from `packages/core/src/cli/create.ts`
- `formatHumanValidationError` from `packages/core/src/cli/format-error.ts`
- `SelectedCommand`, `CliState`, `Entry`, `FetchEntry`, `GroupEntry`, and `AliasEntry` from `packages/core/src/types.ts`
- `renderHelp` from `packages/core/src/help/render.ts`
- `renderTypegen` from `packages/core/src/command/typegen.ts`
- `manifestEnvelope`, `mcpToolName`, `selectCommand`, `commandScope`, `childCommands`, `completionCommands`, `outputPolicy`, and `collectCommands` from `packages/core/src/command/registry.ts`
- command guards from `packages/core/src/command/guards.ts`
- `builtinHelpLines` and `builtinSuggestions` from `packages/core/src/cli/builtin-metadata.ts`
- helpers from `packages/core/src/internal.ts`
- `handleMcpHttp` from `packages/core/src/mcp/http.ts`
- parser/config functions from `packages/core/src/parser/*`
- Zod adapter helpers from `packages/core/src/schema/zod.ts`

White-box tests can keep using these while the source tree is tested directly. Package and generated-code boundary tests should prove no consumer imports them from `@lili/core`.

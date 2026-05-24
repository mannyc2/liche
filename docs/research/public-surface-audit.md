# Public Surface Minimization Audit

Status: evidence note. This audits the `@liche/core` root exports after the hard declarative cutover and records the first minimization pass.

## Method

Evidence used:

- `packages/core/src/index.ts` for the exported package root.
- `packages/core/test/api-snapshot.test.ts` for the source-local frozen value/type snapshot.
- `packages/product/test/core-consumer-boundary.test.ts` for package-level import proof.
- `rg "from ['\"]@liche/core['\"]" packages examples docs` for real package-root consumers.
- `packages/core/test/extension-lane-coverage.test.ts` for public-lane extensibility proof.

Current measured surface after the error-factory cutover:

- 22 value exports from `@liche/core`.
- 85 type exports from `@liche/core`.
- Package export map exposes only `"."`, so subpath imports are internal/test-only even when source files export helpers.

## Keep Strongly

These exports have clear non-test consumers or are required to type the main authoring surface.

| Export group | Evidence | Decision |
|---|---|---|
| `defineCli`, `defineCommand`, `z` | Used by Product generation, build/release CLIs, examples, docs, and generated fixtures. | Core authoring surface. Keep. |
| `createConfig` plus config/provenance types | Used by build/release CLIs, examples, generated fixtures, and config docs. | Core primitive. Keep. |
| `middleware`, lifecycle event types, hook types | Used by examples and the extension-lane property test; required for opt-in extension lanes. | Extension lane. Keep. |
| `CliInstance`, `ServeOptions`, `RunContext`, handler/result/error/helper types | Used by package tests, release/product command wrappers, and public handler signatures. | Public type support. Keep unless signatures are reshaped. |
| `callHttpOperation`, `serializeHttpOperationRequest`, HTTP operation types | Used by Product conformance and generated remote command fixtures. | Shared generated/runtime transport primitive. Keep. |
| `resolveAuth`, `resolveContext`, `createFileSessionStore`, generated auth command helpers, auth/session types | Used or emitted by Product generated CLI source when auth/session is enabled. | Shared auth/session runtime. Keep. |
| `createLocalTelemetrySink` | Used by Product generated telemetry wiring and public package readiness fixtures. | Opt-in telemetry primitive under `@liche/extensions/telemetry`; generated doctor checks are Product-owned code, not a public extension helper. |
| `ok`, `fail`, `commandError`, `CommandError` | Used for command-authored outcomes, hook policy failures, structured recovery, and public error envelopes. | Public recovery/error contract. Keep. |

## Watch List

These exports are not wrong, but the current repo evidence is weaker than the groups above. Do not remove them in this slice; use these as focused cleanup candidates if the public surface needs to shrink before v1.

| Export | Evidence | Tradeoff | Next check |
|---|---|---|---|
| `Formatter` namespace | Used by core tests and docs, not by Product/build/release runtime imports. | Public formatting helpers are convenient for handwritten CLIs, but they expose renderer implementation details. | Either document `Formatter` as a stable helper surface or move users toward CLI `serve()` output modes only. |
| Type aliases such as `Awaitable`, `ConfigDefinition`, `ConfigObjectDefinition`, `ConfigValueSource`, `OptionValueSource`, `SourceInspector` | Public signatures reference them. | Exporting helper aliases avoids unnameable public types, but increases apparent API size. | Shrink only by reshaping public signatures; do not remove aliases while exported types still name them. |

## Removed Or Privatized

These exports were removed from the package root after the audit because the only package-root evidence was the boundary snapshot itself.

Deleted entirely:

| Deleted export | Why it was deleted |
|---|---|
| `authMetaFromCredential` | Generated code and package-level consumers do not import it directly; auth metadata still travels through generated manifests and MCP projections. It had no runtime caller after tests stopped importing it. |
| `ResolvedAuthMeta` | Only existed to type `authMetaFromCredential`; no remaining public signature needs it. |

Private implementation helpers:

| Helper removed from root | Why it stays private |
|---|---|
| `defaultSessionRoot` | `createFileSessionStore()` owns the default path decision; external callers can still pass an explicit root. |
| `isValidProfileName` | Profile validation remains session-store behavior; no package-root consumer fixture needs the predicate. |
| `probeIdentity` | Identity probing is used by generated auth helpers and OAuth flows, not as a standalone package-root primitive. |
| `redactTelemetryValue` | Redaction remains inside `createLocalTelemetrySink`; custom redaction is not yet a public extension lane. |

Internalized after the object-first error cutover:

| Helper removed from root | Why it stays private |
|---|---|
| `BaseError`, `LicheError`, `ParseError`, `ValidationError` | Public command code now emits `CommandError` objects through `ok` / `fail` / `commandError` / `ctx.error`. Typed classes remain source-path internals for parser/schema/auth/HTTP and white-box tests. |

## Not Public Despite Source Exports

Several source modules export helpers for internal composition or white-box tests. They are not package API because `packages/core/package.json` exports only `"."`.

Examples:

- `stateSymbol`, `InternalCli`, parser helpers, command registry helpers, and command guards.
- `Mcp`, `Skill`, `Completions`, `Help`, `Parser`, `Fetch`, and schema-adapter namespaces removed from the package root.
- `formatHumanValidationError`, `mcpMessage`, `serveMcp`, `handleMcpHttp`, `skillMarkdown`, `writeMcp`, `defaultSessionRoot`, `isValidProfileName`, `probeIdentity`, and `redactTelemetryValue` are implementation details unless intentionally promoted later.

White-box tests may import these from source subpaths, but that is not promotion evidence. Generated code and external consumers must stay on `@liche/core`.

## Recommendation

The first minimization pass removed the low-evidence value exports. The next pass should be narrower:

1. Decide whether the watch-list values are user-facing helpers or implementation details.
2. For each value kept public, add one package-root consumer fixture that demonstrates why an external CLI or extension needs it.
3. For each value without a real consumer, remove it from `packages/core/src/index.ts`, update `packages/core/test/api-snapshot.test.ts`, and update `packages/product/test/core-consumer-boundary.test.ts`.

The highest-risk remaining value removal is `Formatter`, because it changes handwritten CLI formatting ergonomics and the test/debug story.

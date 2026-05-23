# Public Surface Minimization Audit

Status: evidence note, not an API change. This audits the current `@lili/core` root exports after the hard declarative cutover and extension-lane guard.

## Method

Evidence used:

- `packages/core/src/index.ts` for the exported package root.
- `packages/core/test/api-snapshot.test.ts` for the source-local frozen value/type snapshot.
- `packages/product/test/core-consumer-boundary.test.ts` for package-level import proof.
- `rg "from ['\"]@lili/core['\"]" packages examples docs` for real package-root consumers.
- `packages/core/test/extension-lane-coverage.test.ts` for public-lane extensibility proof.

Current measured surface:

- 28 value exports from `@lili/core`.
- 86 type exports from `@lili/core`.
- Package export map exposes only `"."`, so subpath imports are internal/test-only even when source files export helpers.

## Keep Strongly

These exports have clear non-test consumers or are required to type the main authoring surface.

| Export group | Evidence | Decision |
|---|---|---|
| `defineCli`, `defineCommand`, `z` | Used by Product generation, build/release CLIs, examples, docs, and generated fixtures. | Core authoring surface. Keep. |
| `Config` plus config/provenance types | Used by build/release CLIs, examples, generated fixtures, and config docs. | Core primitive. Keep. |
| `middleware`, lifecycle event types, hook types | Used by examples and the extension-lane property test; required for opt-in extension lanes. | Extension lane. Keep. |
| `CliInstance`, `ServeOptions`, `RunContext`, handler/result/error/helper types | Used by package tests, release/product command wrappers, and public handler signatures. | Public type support. Keep unless signatures are reshaped. |
| `callHttpOperation`, `serializeHttpOperationRequest`, HTTP operation types | Used by Product conformance and generated remote command fixtures. | Shared generated/runtime transport primitive. Keep. |
| `resolveAuth`, `resolveContext`, `createFileSessionStore`, generated auth command helpers, auth/session types | Used or emitted by Product generated CLI source when auth/session is enabled. | Shared auth/session runtime. Keep. |
| `createLocalTelemetrySink`, `runLocalDoctor`, local ops types | Used by Product generated ops surfaces and public package readiness fixtures. | Opt-in local ops primitives. Keep while generated ops imports them. |
| `LiliError`, `CommandError` | Used for hook failure, structured recovery, and public error envelopes. | Public recovery/error contract. Keep. |

## Watch List

These exports are not wrong, but the current repo evidence is weaker than the groups above. Do not remove them in this slice; use these as focused cleanup candidates if the public surface needs to shrink before v1.

| Export | Evidence | Tradeoff | Next check |
|---|---|---|---|
| `BaseError` | Mostly docs and direct core tests; no generated/package implementation imports it today. | Keeping it supports external inheritance and consistent error naming; removing it shrinks the public contract. | Decide whether external users should subclass only `LiliError`. If yes, deprecate or internalize `BaseError` before v1. |
| `ParseError`, `ValidationError` | Public tests and docs use them; package implementation generally receives envelopes. | Useful for callers that run lower-level helpers and catch specific failures; also expands the error class surface. | Keep if direct helper calls stay public. Otherwise prefer `LiliError`/`CommandError` envelope handling. |
| `Formatter` namespace | Used by core tests and docs, not by Product/build/release runtime imports. | Public formatting helpers are convenient for handwritten CLIs, but they expose renderer implementation details. | Either document `Formatter` as a stable helper surface or move users toward CLI `serve()` output modes only. |
| `authMetaFromCredential` | Frozen and documented, but current Product generator does not import it directly. | Useful for external agent metadata/reporting from resolved credentials; possibly internal if no consumer needs it. | Add or find one package-root consumer before v1, or mark as internalization candidate. |
| `defaultSessionRoot`, `isValidProfileName`, `probeIdentity` | Frozen and guarded by boundary tests; generated code currently imports auth command helpers and `createFileSessionStore`, not these directly. | They are useful session/auth utilities, but can become support surface churn. | Keep only if generated docs/examples teach direct use or auth/session extension fixtures need them. |
| `redactTelemetryValue` | Boundary snapshot and local tests guard it; Product generated code uses `createLocalTelemetrySink`, not direct redaction. | Direct redaction helper is useful for custom telemetry sinks; otherwise it leaks implementation policy. | Add a custom-sink fixture if this stays public. If not, internalize and keep redaction inside the sink. |
| Type aliases such as `Awaitable`, `ConfigDefinition`, `ConfigObjectDefinition`, `ConfigValueSource`, `OptionValueSource`, `SourceInspector` | Public signatures reference them. | Exporting helper aliases avoids unnameable public types, but increases apparent API size. | Shrink only by reshaping public signatures; do not remove aliases while exported types still name them. |

## Not Public Despite Source Exports

Several source modules export helpers for internal composition or white-box tests. They are not package API because `packages/core/package.json` exports only `"."`.

Examples:

- `stateSymbol`, `InternalCli`, parser helpers, command registry helpers, and command guards.
- `Mcp`, `Skill`, `Completions`, `Help`, `Parser`, `Fetch`, and schema-adapter namespaces removed from the package root.
- `formatHumanValidationError`, `mcpMessage`, `serveMcp`, `handleMcpHttp`, `skillMarkdown`, and `writeMcp` are source-level internals unless intentionally promoted later.

White-box tests may import these from source subpaths, but that is not promotion evidence. Generated code and external consumers must stay on `@lili/core`.

## Recommendation

Do not shrink the public API in the same branch that just landed recovery, MCP metadata, and extension-lane guardrails. The useful next minimization pass is narrower:

1. Decide whether the watch-list values are user-facing helpers or implementation details.
2. For each value kept public, add one package-root consumer fixture that demonstrates why an external CLI or extension needs it.
3. For each value without a real consumer, remove it from `packages/core/src/index.ts`, update `packages/core/test/api-snapshot.test.ts`, and update `packages/product/test/core-consumer-boundary.test.ts`.

The most likely first cleanup candidates are `authMetaFromCredential`, `defaultSessionRoot`, `isValidProfileName`, `probeIdentity`, and `redactTelemetryValue`. The highest-risk removals are `Formatter`, `ParseError`, and `ValidationError`, because they change the handwritten CLI ergonomics and test/debug story.

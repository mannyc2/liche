# Changelog

All notable changes to the liche package suite are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the suite follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with synchronized versions across:

- `@liche/core`
- `@liche/extensions`
- `@liche/product`
- `@liche/build`
- `@liche/releases`

While the suite is pre-`1.0.0`, minor bumps (`0.x.0`) are the breaking-change lane and patch bumps (`0.x.y`) preserve public imports and command behavior. See [release-and-distribution.md](./docs/release-and-distribution.md#versioning-policy) for the full policy.

## Unreleased

## 0.8.1 — 2026-05-27

Partial-publish recovery release. The v0.8.0 publish workflow hit a transient sigstore TLOG `409` mid-stream after publishing 5 of 15 packages (`@liche/core`, `@liche/auth`, `@liche/config`, `@liche/completions`, `@liche/mcp-installer`). 0.8.1 republishes all 15 packages at a fresh version so the suite is once again synchronized on the npm registry. No source changes vs 0.8.0; the 0.8.0 entry below covers everything shipping here.

## 0.8.0 — 2026-05-27

### Fixed

- **`@liche/telemetry`: `telemetry status` now resolves invocation and consent from the run-invocation env (`RunOptions.env` / `ctx.sources`) instead of merging ambient process env.** Previously, CI markers in `Bun.env`/`process.env` leaked through `telemetry status` output even when the caller supplied an explicit `env` map to `run(cli, argv, { env })`. Hosts that pass a hermetic env now see deterministic status results.
- **`@liche/telemetry`: invocation detector honors `LICHE_INVOCATION=cli|ci|agent|mcp`.** A declared invocation value wins over CI-marker fallback, matching `@liche/auth`'s detection policy. `telemetry status` reads it from the run-invocation env (`RunOptions.env`); the lifecycle event subscriber reads it from `TelemetryOptions.env` (the env source configured at extension-install time), so a host that wants `agent`/`mcp` event gating must set `LICHE_INVOCATION` on whichever env source the surface uses. Lifecycle subscribers honoring per-run `RunOptions.env` remains a deferred follow-up. CI-marker fallback is unchanged.

### Changed (breaking)

- **`@liche/core`: machine formats always emit the full `Result` envelope.** `--json`, `--format json`, `--format jsonl`, and `--format yaml` now return `{ ok, data, error, meta? }` for every CLI — handwritten and generated. Bare `data` under `--json` is gone. Domain renderers (`md`, `csv`, custom `commandFormatRenderers` and extension renderers) continue to receive bare `data`/`error`. `--filter-output` against a machine format rewrites the envelope's `data` field and preserves `ok`/`error`/`meta`; against a domain format it filters bare data. Streaming under `--format jsonl` now writes one `{ type: 'chunk', data }` line per yield **plus a trailing envelope line**, matching `cli.fetch()` NDJSON.

- **`@liche/core`: removed `--full-output` global, `OutputControlsOptions.fullOutput`, and `GlobalFlags.fullOutput`.** Its envelope-toggle role is subsumed by the always-envelope rule above; its `machine-only` policy override is now available by passing any machine format (`--json`/`--format json|jsonl|yaml`) — those already flip `formatExplicit` to `true` and bypass the suppression.

- **`@liche/core`: removed `CreateOptions.generated` / `defineCli({ generated: { machineOutput: 'envelope' } })`.** The field is no longer needed; the envelope contract is unconditional.

- **`@liche/core`: invalid JSON request bodies now return HTTP 400 with `INVALID_REQUEST_BODY` envelope.** `cli.fetch()` previously dropped malformed bodies silently and ran the handler with no body. Empty bodies still succeed with command defaults; only non-empty malformed JSON is rejected.

- **`@liche/core`: added `FieldErrorSource` variant `{ kind: 'output' }` for output-validation failures.** The executor now attaches this source on field errors raised by output-schema validation, so human diagnostics render as `command output "$.path"` instead of being misclassified as `--option` or env-variable errors. The path-based label inference fallback in `formatHumanValidationError` is gone; field errors that arrive without a `source` render as a neutral `<path>` argument.

- **`@liche/product`: generated CLIs no longer emit `generated: { machineOutput: 'envelope' }` or `fullOutput: true`.** Regenerate downstream fixtures.

### Removed

- **`@liche/skills-runtime`: `--full-output` no longer toggles full skill markdown.** `--llms` always emits the markdown index. Call `skillMarkdown(name, state)` programmatically for the long-form skill content.

## 0.7.0 — 2026-05-27

### Added

- **`@liche/core`: `arg.*` namespace for strict CLI argument codecs.** `arg.number`, `arg.int`, `arg.positiveInt`, `arg.port`, and `arg.boolean` are Zod codec factories that replace broad `z.coerce.*` at the CLI/env/fetch string boundary. ASCII decimal grammar only (no leading `+`, no leading zeroes, no exponent notation, no `Infinity`/`NaN`, no whitespace); `arg.boolean` accepts only `"true"`/`"false"`/`"1"`/`"0"` plus JSON booleans. JSON Schema projection inherits range/integer constraints on both string-regex and number branches so `--schema`, command manifests, and extension tool schemas describe the boundary input shape with the same constraints the runtime enforces.

  ```ts
  defineCommand({ args: { port: arg.port(), retries: arg.int().min(0) } })
  ```

- **`@liche/core`: `arg.fromString({ input?, output, surface?, decode, encode? })`.** Declare CLI-shaped string inputs that decode into custom runtime values (URL, `ReadableStream`, parsed file contents). Optional `surface: 'cli' | 'fetch' | 'all' | { kind: 'extension', transport }` records the transports on which the codec is callable. The decode `ctx` is now properly typed (`ArgDecodeContext<I>`); decoders can `ctx.issues.push(...)` and `return z.NEVER` without casts and the issue flows through `ValidationError`.

- **`@liche/core`: `checkCommandSurface(entry, surface)` predicate.** Public surface-aware adapter API. Returns `{ ok: false, field, codecKind, surface }` on the first rejection so transports can refuse to invoke a command whose runtime codec is not callable on that surface. `cli.fetch` short-circuits to HTTP 400 + `UNSUPPORTED_SURFACE` (both JSON and streaming paths) before the handler runs; `@liche/mcp-server` filters `tools/list` and short-circuits `tools/call` with JSON-RPC `-32602` + `data.code = 'UNSUPPORTED_SURFACE'` carrying `codecKind`/`field`/`surface`. New public types: `CommandSurface`, `StoredCodecSurface`, `SurfaceCheckResult`, `ArgDecodeContext<I>`, `ArgIssue`.

- **`@liche/core`: `parseInvocation` parse-only public API.** Validates argv against a CLI's contracts and returns a structured result (selected command, parsed input, ctx patch) *without* executing the handler. Use it to dry-run, route, or pre-validate before deciding to dispatch.

- **`@liche/core`: async schema parsing for command input and output.** Command-input and output schemas may be async (e.g. `z.string().refine(async (v) => …)`). `parseArgsAsync`/`parseSchemaAsync` await refinements end-to-end through argv parsing, env resolution, HTTP operation transport, and the parse-invocation API.

- **`@liche/core`: source-aware validation surfaces.** Validation errors now carry field provenance (CLI flag, env var, body field) so renderers can point users at where a value actually came from rather than guessing.

### Changed

- **`@liche/core`: `cli.serve` is now `cli.run`** (terminal entrypoint renamed; `src/cli/serve.ts` → `src/cli/terminal.ts`). Top-level `run(cli, argv?, options?)` is published as the effectful CLI entrypoint. Update call sites:

  ```diff
  - import { serve } from "@liche/core";
  - await serve(cli, Bun.argv.slice(2));
  + import { run } from "@liche/core";
  + await run(cli, Bun.argv.slice(2));
  ```

- **`@liche/core`: safety and auth primitives moved out of core.** Auth errors, resolve helpers, and types now live in `@liche/auth`. Imports must move:

  ```diff
  - import { AuthError, resolveAuth, type AuthSession } from "@liche/core";
  + import { AuthError, resolveAuth, type AuthSession } from "@liche/auth";
  ```

- **`@liche/core`: `CommandContract.agent` replaced by flat `interactive?: boolean`.** Polarity flips: `agent: false` → `interactive: true`. MCP/skills-runtime filters become `!command.interactive`. Setup/management commands previously marked `agent: false` for hide-from-MCP reasons (telemetry status, config doctor, completions, mcp install, skills add/list) are unmarked and become MCP-visible. Product generator no longer emits `interactive: true` for workflow capabilities.

- **`@liche/core`: `InvocationKind` removed from core.** `RunContext.invocation`, `CliEvent.invocation`, and `ExecuteInput.invocation` are gone. `@liche/auth` keeps a local `InvocationKind` plus a `detectInvocation` helper that reads CI from env via `ctx.sources` and honors `LICHE_INVOCATION` for MCP/agent surfaces.

- **`@liche/core`: `CliEvent.mcp` and `CliEventSurface.kind 'mcp'` removed.** Added `CliEvent.attributes` as a generic extension-metadata bag. `CliEventType` is now open (`(string & {})`) so extensions can publish their own event names.

- **`@liche/core`: synthesized `machine` boolean removed from `RunContext`/`CliEvent`.** No caller read it; every site was a write. Lifecycle carries `isTty` instead — derive machine-output mode from `!isTty || formatExplicit`.

- **`@liche/core`: `OutputPolicy 'agent-only'` renamed to `'machine-only'`.**

- **`@liche/agents`: agents extension now owns MCP/skills command visibility policy.** Product-generated CLIs no longer emit annotations Core never read; visibility decisions live in `@liche/mcp-server` and `@liche/skills-runtime`.

- **`@liche/extensions`: agent helpers regrouped under `extensions/agents/`.** Internal repo layout; no public import path changes for already-published packages.

### Removed

- **`@liche/core`: legacy curl-style fetch command mode.** `defineCommand({ fetch, basePath })` and the `FetchEntry` runtime variant are gone, along with the internal `callFetch`/`parseCurl` curl-argv parser and the exported `FetchHandler` type. Commands that exposed a `(request: Request) => Response` handler invoked via `-X POST -H ... -d ...` argv are replaced by the regular typed-command surface — define `args`/`input` schemas and let the HTTP operation transport (`cli.fetch`) handle Request/Response shaping. The `FetchRoute`/`FetchRouteInput` HTTP-operation API is unaffected.

### Fixed

- **`@liche/core`: surface walker now recurses through wrappers and composites.** `checkCommandSurface` previously inspected only direct codec metadata and `ZodObject` shapes — a CLI-only codec inside `.optional()`/`.default()`/`.nullable()`/`.catch()`/`.readonly()` on an object, or inside `z.array`/`z.tuple`/`z.record`/`z.map`/`z.set`/`z.union`/`z.discriminatedUnion`/`z.intersection`, returned `{ ok: true }` so `cli.fetch` executed the handler and MCP listed/called the command. The walker now unwraps wrappers before the composite check, recurses into every composite shape (including `z.lazy`, `z.pipe`, `z.promise`, record keys, object `catchall`), tracks visited nodes to handle cycles, and builds a structural field path (`[]` arrays/sets, `[i]` tuple positions, `{}` record/map values, `|i` union alternatives, dot-joined object fields).

- **`@liche/core`: `arg.fromString` decoder `ctx` is now typed.** Previously `unknown`, requiring a cast to access `ctx.issues`. New public types `ArgDecodeContext<I>` and `ArgIssue` are locked in the API snapshot.

## 0.6.0 — 2026-05-26

### Added

- **`@liche/core`: `defineGlobal({ default })`.** Globals can declare a pre-resolved fallback that populates `ctx.global.<key>` when the flag is absent and renders as `(default: …)` in help. `parse` does not run on the default.

  ```ts
  defineGlobal({ key: 'db', type: 'string', default: 'twitte.sqlite', valueLabel: 'path' })
  ```

- **`@liche/core`: per-command output renderers via `defineCommand({ formats })`.** Attach a format-specific render function on a single command without registering a CLI-wide renderer. Runs at the `result` stage when the chosen output format matches; structured formats (`--json`) still route to the registered renderer.

  ```ts
  defineCommand({
    path: ['report'],
    formats: { md: (data) => formatTable(data) },
    run: () => collectRows(),
  })
  ```

- **`@liche/core`: value tokens in the per-command options table.** Non-boolean options render as `--name <name>` in help (matching the usage line). Override the placeholder via zod meta: `z.string().meta({ valueLabel: 'path' })`.

- **`@liche/core`: bare-string shorthand for single-segment command aliases.** `defineCommand({ aliases: ['find', ['s']] })` is accepted alongside the existing nested-array form.

### Changed

- **`@liche/core`: standard globals are now explicit controls.** Plain `defineCli()` no longer reserves `--help`, `--version`, `--json`, `--format`, `--schema`, `--llms`, or output-slicing flags. Install `help()`, `version()`, `outputControls()`, and `reflectionControls()` for those Core-owned flags.
- **`@liche/agents`: `--llms` moved out of Core.** Install `llms()` directly or `agents()` for the bundled agent surface. Product-generated CLIs now install their selected controls visibly in generated source and reject `--format` through normal unknown-option parsing instead of `disabledGlobals`.

## 0.4.0 — 2026-05-24

### Changed

- **`@liche/extensions`: removed the broad `support` subpath.** Local telemetry primitives moved to `@liche/telemetry`. Imports must move to the focused package:

  ```diff
  - import { createLocalTelemetrySink } from "@liche/extensions/support";
  + import { createLocalTelemetrySink } from "@liche/telemetry";
  ```

- **`@liche/product`: generated `doctor` is now Product-owned generated code** rather than a public helper exported from `@liche/extensions`. Diagnostics now scale with your catalog (config fields, remote base URLs, auth providers, session/context, agent-readiness) without a separate install. Regenerate Product surfaces to pick up the new `doctor` command:

  ```sh
  liche-product generate ./product.ts --out ./generated
  ```

## 0.3.1 — 2026-05-24

Release-candidate hardening. No public API changes.

### Added

- `bun run release:check` — local release-candidate gate. Runs typechecks, package tests, example smokes, metrics, offline metadata checks, and whitespace diff checks. No network access required.
- `bun run --silent metrics` — records per-package source/test LOC, public exports, runtime dependencies, and package-boundary exceptions for release-candidate review.
- `bun run --silent release:metadata` — offline check that every publishable package has `LICENSE`, narrow `files` lists, and no placeholder package metadata.
- `bun run release:names` — live npm registry status probe (kept separate from `release:check` so network/ownership facts don't make local RC checks flaky).
- `SECURITY.md`, `SUPPORT.md`, per-package `LICENSE` files.

## 0.3.0 and earlier

`@liche/core` `0.2.0` and `0.3.0`, and `0.3.0` of the rest of the suite, were published during the pre-public rewrite. They are listed here for completeness but predate this changelog and are not recommended for new projects — start from `0.4.0` or later.

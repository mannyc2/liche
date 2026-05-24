# Next implementation plan

This plan starts after the current Bun-native core builder work. It assumes a hard cutover to the target package layout when implementation begins.

## Success criteria

- Root repo is a Bun workspace monorepo.
- Current core behavior lives in `packages/core` with no build or releases dependency.
- `packages/extensions` owns official optional extension factories over public `@liche/core` lanes.
- `packages/product` owns product schema authoring, canonical catalog normalization, generation, drift checks, Product compile orchestration, and server conformance.
- `packages/build` owns reusable Bun build/compile primitives for generated and handwritten CLI entrypoints.
- `packages/releases` owns release manifests, final binary verification, renderer selection, package-manager artifact rendering, and yank planning.
- `@liche/core` exposes the extension protocol plus config resolution/provenance semantics; `@liche/extensions` exposes the config authoring factory for handwritten CLIs, and generated Product CLIs import extensions only when needed.
- There is no `release-extra` package. Users choose zero to all release renderers through release configuration.
- Generated surfaces are tracked through a surface manifest with source digests, generator versions, generation options digests, output digests, and artifact lists.
- Existing core tests pass after the package move, and new rewrite tests trace to `docs/coverage-rewrite.md`.

## Phase 1: monorepo cutover

Move the current package into the target workspace shape:

```txt
packages/core
packages/extensions
packages/build
packages/product
packages/releases
examples/
docs/
```

Verification:

- `bun install` resolves from the workspace root.
- `bun test packages/core/test` passes against the moved core package.
- `bun run check` or package-local typecheck passes without build/releases package imports leaking into core.
- Package export checks prove `docs/` is not published as a package or runtime command.

## Phase 2: core boundary freeze

Lock down the public runtime surface before adding generator behavior:

- `defineCli()`, `defineCommand()`, `.serve()`, `.fetch()`
- parser/config/env validation (core behavior, not a public helper namespace)
- formatter and output envelopes
- MCP basics (core behavior; reachable through `cli.fetch()`/`cli.serve()`)
- skill/docs helpers (core behavior; not exposed as a state-shaped namespace)
- JSON envelope support for generated schema-driven commands, including metadata channels for execution mode

Outbound HTTP operation serializer and transport (`serializeHttpOperationRequest`, `callHttpOperation`) were deliberately not part of the Phase 2 freeze. They landed in the Phase 4-A core transport slice and are now part of the re-frozen public surface.

The concrete public/exported surface decision lives in `docs/core-api-boundary.md`.

Verification:

- Core parity, golden, contract, property, formatter, MCP, and skill tests pass from `packages/core`. OpenAPI tests move to `@liche/product` when that package's catalog-driven generator lands.
- A dependency boundary test proves `@liche/core` does not import `@liche/build`, `@liche/product`, or `@liche/releases`.
- A package-consumer boundary test in `@liche/product` imports `@liche/core` by package name and asserts the resolved value exports equal the approved frozen surface from `docs/core-api-boundary.md`.
- A source-level API snapshot test in `@liche/core` locks both value and type exports against `docs/core-api-boundary.md`.
- A generated-command fixture can request `--json` and receive a structured envelope, not ad hoc text. (Deferred until Phase 3 produces the first generated fixture.)

## Phase 2A: agent consistency closure

Close the agent-facing gaps found in the consistency audit before expanding generation:

1. Define the default generated vocabulary: verbs `get`, `list`, `create`, `update`, `delete`, `run`; flags `json`, `local`, `remote`, `force`. Treat vocabulary as an allowlist that contracts can extend with `vocabulary({...})` or replace by passing an explicit vocabulary object.
2. Implement schema lints for positive vocabulary membership.
3. Make `--json` the canonical generated CLI machine-output contract. Keep current core `--format` behavior only as handwritten compatibility unless a requirement explicitly promotes it.
4. Make generated built-ins and helper commands honor `--json`.
5. Add execution-mode resolution and output signaling for generated capabilities.
6. Replace runtime-reflection OpenAPI for schema-driven product schemas with catalog-derived OpenAPI that consumes HTTP bindings and field metadata.

Verification:

- A fixture resource action using `projects info` fails `vocabulary/verb` when `info` is absent from the active vocabulary.
- A fixture resource action using a product-specific verb passes when that verb is added to the active vocabulary.
- A generated command with `--format json` fails or is absent from help; the same command with `--json` succeeds.
- Generated helper commands emit parseable JSON when `--json` is passed.
- Mixed execution fixtures reject conflicting flags where both local and remote are supported, honor flag > config > schema default, and include `meta.execution.mode` plus `meta.execution.source`.
- Generated OpenAPI for a `GET` resource operation emits path/query/header/body placement from HTTP binding metadata and excludes local-only commands.

## Phase 2B: declarative core and plugin extraction

Simplify `@liche/core` around one declarative command contract. Core should own the runtime contract every command depends on; optional projections and client/vendor workflows should move behind plugin-style packages or opt-in adapters.

Status: the core hard cutover has landed. Core stores serializable `CommandContract` records at command registration time, keeps handlers and runtime schemas in a separate runtime entry, and drives manifest, schema, help, skill, and MCP projection from the contract boundary. Public manifests no longer expose runtime state, core formats are limited to JSON/JSONL/YAML/Markdown, and the public handwritten authoring path starts with `defineCli()` plus `defineCommand()` data objects. Additional renderers belong outside `@liche/core`.

Core responsibilities:

- command declaration, parsing, validation, execution, and lifecycle hooks
- args, options, env, config, provenance, and structured errors
- JSON/JSONL output plus the standard result envelope
- command contract and schema export for handwritten CLIs
- MCP tool projection only when it is a direct view of the command contract

Plugin or separate-package responsibilities:

- nonessential renderers and export formats beyond the standard core set
- vendor-specific agent publishing workflows beyond core `skills add`
- client-specific MCP workflows beyond core `mcp add`
- config mutation UX such as `config set`, `config edit`, and comment-preserving writes
- extended doctor checks, hosted/export telemetry sinks, release/build helpers, and Product-specific generated surfaces

Narrow runtime exception:

- Direct MCP runtime execution over the command contract stays in core because it shares executor semantics.
- Config loading/provenance semantics stay in core, while config authoring and inspection commands move behind extensions.
- `mcp add`, `skills add`, config diagnostics, completions, agent setup helpers, auth workflows, and telemetry sinks move behind `@liche/extensions` subpaths.

Implementation target:

1. `CommandContract` is the serializable boundary for metadata, schemas, config bindings, safety/effects annotations, examples, output contract, and projection hints.
2. Runtime entries are `CommandContract + runtime`; `run`, `fetch`, raw Zod handles, and middleware stay outside the serialized projection contract.
3. `defineCli()` / `defineCommand()` are the canonical handwritten API, with command `path`, aliases, input schemas, output schema, safety metadata, docs metadata, and handler separated in one data-first object.
4. Public manifest output excludes internal-state fields; the old fluent command builder is removed rather than kept as a compatibility adapter.
5. Register extension-provided helper commands through the normal command registry, while pushing vendor/provider workflows into adapters backed by public contracts.
6. Remove nonessential renderers from core; optional renderers belong in plugin packages.

Verification:

- A contract fixture can emit schema, manifest, help, and MCP tool definitions without executing command handlers.
- A declarative fixture can execute direct and aliased nested command paths while manifest and MCP projection read safety metadata without executing the handler.
- Public manifest JSON contains only serializable contract data and no `Entry`, `CliState`, function, absolute path, timestamp, or runtime handle.
- Core package dependency and import tests prove `@liche/core` does not depend on plugin packages, Product, Build, or Releases.
- Disabling optional extensions removes their registered commands (`completions`, `config doctor`, `skills add`, `skills list`, `mcp add`, and auth workflow commands); disabling optional adapters removes nonessential renderers and telemetry sinks without changing command execution, JSON/JSONL output, config provenance, or structured errors.
- Generated Product surfaces consume catalog outputs or `CommandContract` artifacts and do not rely on weaker runtime reflection when a canonical generated surface exists.

## Phase 3: product vertical slice

Implement the smallest product package slice that proves the architecture:

1. Define runtime schema API and canonical catalog normalization.
2. Generate one command tree through `@liche/core` public APIs.
3. Generate deterministic provenance headers.
4. Add `generate --check` for generated-file freshness.
5. Include both a CRUD-like resource operation and a workflow command in fixtures.

Verification:

- Equivalent handwritten and generated commands return the same output for the same input.
- Canonical IR digest ignores source formatting and excludes raw Zod handles, functions, absolute paths, timestamps, and secrets.
- A hand-edited generated file fails `generate --check`.
- The workflow command is not forced into a resource model or HTTP endpoint.

## Phase 3A: surface graph slice

After one generated command works, make generated outputs explicit and synchronized:

- emit a generated surface manifest for CLI, command manifest, OpenAPI, MCP command tools, Agent Skill/LLM surfaces, docs/reference markdown, and config JSON Schema when configured
- record each surface's source (`catalog` or `openapi`), input digest, generator version, generation options digest, output digest, and relative artifact paths
- keep command MCP tools catalog-derived
- reserve OpenAPI-derived downstream surfaces for later adapters such as SDKs, Terraform providers, and Code Mode MCP servers
- reject requested product-specific surfaces such as `wrangler.jsonc`, Workers Binding RPC metadata, dashboard metadata, or generated server/API code unless an explicit adapter requirement exists

Verification:

- Touching any generated surface makes `generate --check` fail with the stale surface ID.
- Two formatted-equivalent schemas produce the same catalog-derived surface input digests.
- Changing a generation option changes the affected surface output digest without changing the catalog digest.
- A requested unsupported product-specific surface fails with an actionable "adapter not implemented" error instead of silently emitting partial artifacts.

## Phase 3B: product schema refactor

Hard-cut `@liche/product` from operation-contract authoring to product-schema authoring before adding OpenAPI.

Status: Product authoring now starts from `defineProduct({ ... })`, with resources, commands, config, remote, auth, contexts, permissions, ops, and bindings declared as sibling data fields. The old chained Product builder has been removed from the package root, internal tests, and `packages/product/src/product.ts`.

Public API:

```txt
defineProduct({
  resources,
  commands,
  bindings
})

Field.*
Shape.*
Command.workflow(...)
Command.local(...)
Command.remoteHttp(...)
```

Internal compiler model:

```txt
Runtime product schema classes
  -> normalized Catalog
  -> flattened Capability[]
  -> generated surfaces
```

Implementation requirements:

- replace the old `Contract.create(...).operation(...)` fixture path with `defineProduct({ resources, commands })`
- model resources, commands, and bindings as siblings
- preserve field metadata in normalized shape projections
- normalize surface defaults once (`cli`, `docs`, `dashboard`, `agent`, `openapi`)
- keep command execution mode explicit: `remote-http`, `local`, or `hybrid-workflow`
- make generated CLI consume `Capability[]`, not operation-specific records
- keep generated code lowering through public `@liche/core` APIs
- keep the surface manifest and `generate --check` working through the refactor

Verification:

- A workers fixture with one resource operation, `deploy`, `dev`, and one binding normalizes to a stable catalog.
- The generated CLI includes the resource operation plus top-level `deploy` and `dev` commands.
- `dev` is not treated as HTTP-capable; `deploy` remains a hybrid workflow, not a fake resource mutation.
- Field metadata changes affect the catalog digest; source formatting and class instance identity do not.
- `bun run --filter @liche/product check` and `bun run --filter @liche/product test` pass after removing the old operation-contract fixture.

## Phase 3C: OpenAPI projection

Implement OpenAPI as the next real surface after the product schema refactor.

OpenAPI generation consumes:

- normalized HTTP-capable capabilities
- `http.method`, `http.path`, and `http.bind`
- input/output shape JSON Schema
- field metadata for descriptions and `x-liche-*` extensions
- normalized surface membership

OpenAPI generation must not consume:

- generated CLI source
- core runtime reflection
- raw product schema source text
- local-only command handlers

Verification:

- Resource HTTP operations appear in `openapi.json`.
- `remote-http` commands appear unless `surfaces.openapi === false`.
- `local` commands such as `dev` never appear.
- `hybrid-workflow` commands such as `deploy` are excluded by default and only appear when explicitly opted in with an HTTP trigger.
- Field metadata appears as OpenAPI descriptions and extensions.
- The generated surface manifest records separate `cli` and `openapi` surface entries with independent output digests.
- Hand-editing `openapi.json` makes `generate --check` fail with the `openapi` surface id.

## Phase 3C-QA: product mutation testing

Set up mutation testing for `@liche/product` using the same local workflow as `@liche/core`.

Implementation requirements:

- add `packages/product/stryker.conf.mjs`
- add `mutate: "stryker run"` to `packages/product/package.json`
- add Stryker/Bun-runner dev dependencies through the existing root workspace catalog
- include `stryker.conf.mjs` in the product package TypeScript config
- mutate implementation modules for catalog normalization, digesting, lints, generators, manifest checks, and product-schema builders
- exclude public barrels, `liche-product` CLI wrapper code, packaged skill text, generated fixtures, and tests from mutation input
- start with the same thresholds as core unless the first measured baseline proves a narrower first gate is needed

Verification:

- `bun run --filter @liche/product check` passes with the config included in TypeScript checking.
- `bun run --filter @liche/product mutate` starts Stryker with the Bun test runner and completes an initial report.
- The initial report names surviving mutants that should become focused follow-up tests rather than broad snapshot updates.
- The root workspace remains clean: no duplicate Stryker versions, no package-local lockfile, and no mutation artifacts committed.

## Phase 3D: auth/session catalog and runtime foundation

Implement auth/session in staged slices from `docs/auth-session.md`. Keep the API opt-in and do not create `@liche/auth`.

### Phase 3D-A: env auth and capability requirements

Status: landed.

Add catalog support for:

- one auth provider per product
- `Auth.none`, `Auth.apiKey`, and `Auth.bearer`
- token env sources
- product permissions and capability `requires`
- context declarations with explicit flags and env vars
- `SecretString`, `resolveAuth`, `resolveContext`, and `applyAuth` in `@liche/core`
- structured `AUTH_*` errors
- release manifest auth metadata

Verification:

- Env bearer/API key credentials resolve through `SecretString` and never serialize raw values.
- Missing human auth, missing CI token, missing context, and known missing scope produce structured auth envelopes.
- Generated commands add declared context flags and pass resolved credentials into core transport without raw token strings.
- Agent/MCP metadata includes auth requirements/status but no secrets.

### Phase 3D-B: file sessions and context

Status: landed. The default file store, generated profile globals, generated `whoami` / `switch`, selected-context fallback, corrupt-file quarantine, and lock timeout behavior are implemented in `@liche/core` and `@liche/product`.

Add the file-backed `SessionStore` and profile behavior:

- `createFileSessionStore`
- profile selection order
- stored selected context
- generated `whoami` and `switch`
- `--profile`, `--non-interactive`, and `--no-session`
- lock-file writes, atomic rename, corrupt-file handling

Verification:

- Stored profile context is used only when allowed by the resolution rules.
- Env credentials can combine with stored context only when `--profile` is explicit, and status metadata reports both sources.
- Corrupted session JSON is renamed and reported as `AUTH_SESSION_CORRUPT`.
- Concurrent write lock timeout reports `AUTH_SESSION_LOCKED`.

### Phase 3D-C: OAuth device login

Status: landed for explicit OAuth device login/logout. Refresh tokens, remote context pickers, keychain storage, and agent-triggered login remain deferred.

Add generated OAuth device flow only after env auth and sessions are stable:

- generated `login` and `logout`
- human-only verification URI and user code output
- access-token file storage
- no refresh tokens
- no OS keychain dependency
- no implicit login from normal operations

Verification:

- `login` works only in an interactive CLI invocation.
- `--non-interactive`, CI, agent, and MCP invocations never print device user codes or open login.
- Normal auth-required commands fail instead of starting login.

## Phase 4: remote and conformance slice

Prove that generated remote commands and handwritten remote commands share the same core transport:

- core `serializeHttpOperationRequest` and `callHttpOperation` are implemented and frozen; generated wiring calls those APIs when a Product declares a remote base URL
- Product config/base URL authoring is defined and generated commands can source remote base URLs from literals, env vars, or declared config fields
- Product linting and generation fail for HTTP-backed capabilities without a product remote base URL
- generated auth-aware remote wiring calls `resolveAuth`/`resolveContext` before `callHttpOperation`
- output schema validation treats HTTP responses as untrusted
- non-2xx, malformed JSON, unsupported content types, timeout, missing base URL, and missing auth become structured core errors
- 401/403 responses map to auth errors when an auth requirement is present and to remote HTTP errors otherwise
- `liche-product conform` verifies an owned fixture server separately from `generate --check`

Verification:

- Remote serializer tests inspect method, path, query, headers, and body without network.
- Generated remote command tests mock `callHttpOperation`.
- Conformance fixture tests run against a local owned HTTP server.
- Destructive conformance cases skip unless fixture-backed and explicitly opted in.

## Phase 4-B: config primitive and generated base URL wiring

Status: the core config primitive, Product config catalog, and generated base URL wiring are implemented for declared remote sources. The hard cutover is complete: generated Product remote stubs are removed, and catalogs with HTTP-backed capabilities but no product-level remote base URL fail lint/generation.

Core and extension requirements:

- `@liche/extensions/config` exposes `config(...)` for handwritten CLIs
- typed `RunContext.config`
- `RunContext.sources` for config and option provenance
- explicit option-to-config bindings
- project and user config discovery
- strict schema validation
- JSON, JSONC, YAML, and TOML config parsing
- `--config` / `--no-config` parse behavior from the config requirements doc

Product requirements:

- public `@liche/product` `createConfig` helper
- `defineProduct({ config })` as a sibling of `bindings`
- normalized catalog config node
- generated config JSON Schema containing general config fields and bindings
- config lints that reject secret fields in general config
- remote base URL sources from literal, env var, or config field
- generated remote callers resolve base URLs through `ctx.config`, `ctx.env`, or literals before `callHttpOperation`
- generated remote callers report `meta.execution.source` as `config`, `env`, or `schema-default`

Verification:

- a handwritten CLI with `config(...)` receives typed `ctx.config` and provenance
- a handwritten CLI without config rejects `--config` and `--no-config`
- config-to-option binding is explicit; matching option names do not bind automatically
- handwritten tool CLIs use the extension primitive: `liche-build` binds `build.*` and `compileEntry.*` defaults through `config(...)`; `liche-release` binds `package.*` and `publish.*` defaults through `config(...)`
- a Product with config but no bindings still emits a config schema
- a generated Product remote command with a config-backed base URL calls the core HTTP transport and reports `meta.execution.source: "config"`
- a generated Product remote command with an env-backed base URL calls the core HTTP transport and reports `meta.execution.source: "env"`
- a Product with config and bindings emits both in one schema artifact
- a generated remote command resolves `baseUrl` from config before calling `callHttpOperation`
- auth/session values, selected profiles, runtime config values, and provenance stay out of catalog digests and release manifests

## Phase 5: releases spine

Implement renderer-neutral release infrastructure before any ecosystem-specific renderer is treated as special. This `@liche/releases` package slice is implemented through Phase 5F, Phase 6 has baseline npm/PyPI/Homebrew/Scoop renderer implementations, and Phase 7A has the `liche-release publish` dry-run/preflight CLI. Concrete ecosystem publisher adapters, receipts, and provenance capture remain the next release slice.

### Phase 5A: manifest schema and fixture

Add `zod` to `packages/releases`, then add `packages/releases/src/manifest.ts` with:

- `CliReleaseManifestSchema`
- `parseCliReleaseManifest`
- exported manifest and target types
- one checked-in fixture manifest under `packages/releases/test/fixtures/`

Verification:

- `packages/releases/test/manifest.test.ts` rejects malformed manifests.
- The fixture manifest records metadata, executable metadata, subject/contract provenance, runtime env/config expectations, one conformance-metadata case, at least one glibc and one musl binary, and at least one baseline x64 target.
- `bun run --filter @liche/releases check` proves the exported types compile.

### Phase 5B: final binary byte verification

Add a binary verifier that consumes a parsed release manifest plus explicit final binary paths. It must compute sha256 and size from the bytes that will be published after any signing/notarization mutation.

Verification:

- `packages/releases/test/binary.test.ts` creates temporary executable bytes, records their manifest hash and size, then proves changed bytes fail verification.
- The test must simulate a "signed" mutation before hashing so an implementation that hashes pre-signing bytes fails.
- Target/platform/arch/libc/cpuVariant mismatches fail before any renderer runs.

### Phase 5C: renderer registry and selection

Add the shared renderer contract and selection logic:

- renderer ids: `npm`, `pypi`, `homebrew`, `scoop`
- selection inputs: `[]`, one renderer, many renderers, or `"all"`
- selected-renderer metadata/config validation before staging artifacts
- unselected renderers ignored even when their metadata is absent
- no renderer-selection path checks publisher credentials

Verification:

- `packages/releases/test/renderer-selection.test.ts` covers empty, one, many, all, unsupported, duplicate, underconfigured renderer selections, and the absence of publisher credential checks.
- The test registry uses tiny fake renderers; it must not pull npm packaging into Phase 5.
- Implemented in `packages/releases/src/renderers/index.ts`.

### Phase 5D: release package orchestration

Add the orchestration function that validates the manifest, verifies final binaries, resolves renderers, stages renderer outputs, packs final artifacts, and runs final-artifact verifiers. Use a fixture renderer in tests to prove the loop without privileging npm.

Verification:

- `packages/releases/test/release-package.test.ts` proves `renderers: []` still validates the manifest and verifies final binary bytes.
- A fixture renderer receives only the parsed manifest, verified final binary records, and renderer output context, not product schema files, package workspaces, generated source, or build directories.
- Selecting an invalid renderer fails before any staging directory is created.
- Implemented in `packages/releases/src/package.ts` as `packageRelease(...)`.

### Phase 5E: final artifact verification

Final verification must inspect final artifact files, not staging directories. Phase 5 verifies final package artifact bytes against package records; Phase 6 ecosystem renderers add ecosystem-specific unpack/inspect checks such as npm `.tgz` binary hashing and PyPI `RECORD` validation.

Verification:

- The fixture renderer packs an artifact, records a package artifact record with renderer/ecosystem/kind/sha256/size, the verifier reads the final artifact, and a corrupted packed artifact fails even if the staging directory still looks valid.
- No test should accept "directory contains expected files" as the final proof.
- Implemented in `packages/releases/src/artifacts.ts`.

### Phase 5F: manifest-based yank dry run

Add yank planning from one manifest reference. Phase 5 should only produce a dry-run plan; registry mutation and ecosystem-specific publishing behavior stay out of scope.

Verification:

- `packages/releases/test/yank.test.ts` reports every affected package artifact from the manifest.
- The dry run must not require package names or versions that are not derivable from the manifest.
- Implemented in `packages/releases/src/yank.ts` as `planReleaseYank(...)`.

Phase 5 exits only when `bun run --filter @liche/releases check`, `bun run --filter @liche/releases test`, and root `bun run check` pass with no `release-extra` package and no npm-specific renderer implementation.

## Phase 6: renderer implementations

Add ecosystem renderers inside `@liche/releases`. This phase renders and verifies package artifacts; it does not publish them to registries.

- npm umbrella plus platform package directories, with optional derived `.tgz` packing
- PyPI wheels
- Homebrew formula
- Scoop JSON manifest
- WinGet helper flow only when its asynchronous repository workflow is explicitly in scope

Status: npm, PyPI, Homebrew, and Scoop baseline renderers are implemented. WinGet remains out of scope.

Renderer package structure:

- `packages/releases/src/index.ts` exports the release spine but no concrete renderer implementations.
- `packages/releases/src/renderers/index.ts` exports shared renderer types and selection.
- `packages/releases/src/renderers/{npm,pypi,homebrew,scoop}.ts` export one renderer each.
- `packages/releases/src/renderers/all.ts` is the opt-in convenience module that imports all renderers.
- `packages/releases/src/publishers/index.ts` reserves publisher types; concrete publisher adapters belong in Phase 7 subpaths.

Verification:

- Each selected renderer can be tested independently from the same manifest fixture.
- Selecting multiple renderers produces traceable artifacts for the same release version and binary hashes.
- PyPI, Homebrew, and Scoop renderer tests cover ecosystem-specific metadata and final artifact checks, not just generic file emission.
- Yank dry run reports every affected artifact from one manifest reference.
- `packages/releases/test/ecosystem-renderers.test.ts` renders all four implemented ecosystems from one core-command-manifest fixture.
- `packages/releases/test/package-boundary.test.ts` proves concrete renderers stay behind subpath exports without metafile-level bundle assertions.

## Phase 7: distribution automation

Automate publishing npm, PyPI, Homebrew, and Scoop outputs from one release manifest after Phase 6 artifact rendering and verification are stable.

Implemented Phase 7A:

- `liche-release package` writes `package-records.json` and `package-artifacts.json` alongside the release manifest.
- `liche-release publish <manifest> --publishers <id|all>` consumes the release manifest plus verified package records/artifact records without rebuilding or rerendering.
- The CLI produces a dry-run publish plan, checks selected publisher credentials from canonical env vars, rejects missing git repository settings for selected Homebrew/Scoop publishers, and rechecks artifact bytes on `--no-dry-run` before any executor can mutate.
- The CLI intentionally registers no concrete registry executors yet, so a non-dry-run attempt can verify bytes but cannot publish to live registries until the adapter slice lands.

The publish command or API must consume:

- one `CliReleaseManifest`
- the verified final package artifacts recorded for that manifest
- explicit publisher selection (`[]`, one, many, or `"all"`)
- explicit credentials or environment bindings for selected ecosystems

It must not rebuild binaries, rerender packages, read product schema source, read generated source, infer versions from package workspaces, or recover artifact names from registry state. The manifest and verified artifact records are the source of truth.

Required publisher adapters:

| Ecosystem | Publish action |
|---|---|
| npm | Publish platform packages first, then publish the umbrella package after exact-version optional dependencies are available. |
| PyPI | Upload the selected wheels/sdist artifacts that match manifest package records. |
| Homebrew | Update the configured tap formula from manifest URL/sha256 and produce a commit or PR. |
| Scoop | Update the configured bucket JSON manifest from manifest URL/hash and produce a commit or PR. |

Verification:

- A dry-run publish plan lists every registry mutation for npm, PyPI, Homebrew, and Scoop from one manifest reference. Implemented for `liche-release publish` dry-run planning.
- Missing credentials or required repository settings for a selected publisher fail before any mutation. Implemented for `liche-release publish` preflight.
- Artifact hash verification runs immediately before publish and refuses stale or mismatched packed artifacts. Implemented for `liche-release publish --no-dry-run` before executor dispatch. npm publishing should delegate to `npm publish` against either verified tarballs or verified package directories; custom OIDC upload clients are not the default path.
- npm publish ordering publishes platform packages before the umbrella package. Implemented in the publish plan.
- npm and PyPI publisher tests include trusted-publishing/provenance-capable paths when the required CI identity is configured, while token-based fallback stays explicit.
- Homebrew and Scoop publisher tests use local fixture git repositories or dry-run command capture, not live registry mutation.
- Selecting a subset of publishers does not require credentials or metadata for unselected publishers.

Yank/rollback automation remains manifest-based: the same manifest reference must produce the affected npm deprecations, PyPI yanks, Homebrew tap revert/update, and Scoop bucket revert/update plan.

## Do not start with

- a `release-extra` package
- an npm-only release architecture
- framework-specific Vite/TanStack packages
- a broad OpenAPI importer
- generated docs as a shipped package or command
- product-specific surface adapters without explicit requirements

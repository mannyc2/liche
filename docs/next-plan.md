# Next implementation plan

This plan starts after the current Bun-native core builder work. It assumes a hard cutover to the target package layout when implementation begins.

## Success criteria

- Root repo is a Bun workspace monorepo.
- Current core behavior lives in `packages/core` with no build or releases dependency.
- `packages/build` owns product schema authoring, canonical catalog normalization, generation, drift checks, compile orchestration, and server conformance.
- `packages/releases` owns release manifests, final binary verification, renderer selection, package-manager artifact rendering, and yank planning.
- There is no `release-extra` package. Users choose zero to all release renderers through release configuration.
- Generated surfaces are tracked through a surface manifest with source digests, generator versions, generation options digests, output digests, and artifact lists.
- Existing core tests pass after the package move, and new rewrite tests trace to `docs/coverage-rewrite.md`.

## Phase 1: monorepo cutover

Move the current package into the target workspace shape:

```txt
packages/core
packages/build
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

- `Cli.create()`, `.command()`, `.serve()`, `.fetch()`
- parser/config/env validation (core behavior, not a public helper namespace)
- formatter and output envelopes
- MCP basics (core behavior; reachable through `cli.fetch()`/`cli.serve()`)
- skill/docs helpers (core behavior; not exposed as a state-shaped namespace)
- JSON envelope support for generated schema-driven commands, including metadata channels for execution mode

Outbound HTTP operation serializer and transport (`serializeHttpOperationRequest`, `callHttpOperation`) are deliberately not in the Phase 2 freeze: they do not exist in code yet. They are added and frozen as part of Phase 4 (remote and conformance slice), and the public surface re-freezes at that point.

The concrete public/exported surface decision lives in `docs/core-api-boundary.md`.

Verification:

- Core parity, golden, contract, property, formatter, MCP, and skill tests pass from `packages/core`. OpenAPI tests move to `@lili/build` when that package's IR-driven generator lands.
- A dependency boundary test proves `@lili/core` does not import `@lili/build` or `@lili/releases`.
- A package-consumer boundary test in `@lili/build` imports `@lili/core` by package name and asserts the resolved value exports equal the approved frozen surface from `docs/core-api-boundary.md`.
- A source-level API snapshot test in `@lili/core` locks both value and type exports against `docs/core-api-boundary.md`.
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

## Phase 3: build vertical slice

Implement the smallest build package slice that proves the architecture:

1. Define runtime schema API and canonical catalog normalization.
2. Generate one command tree through `@lili/core` public APIs.
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

Hard-cut `@lili/build` from operation-contract authoring to product-schema authoring before adding OpenAPI.

Public API:

```txt
Product.create(...)
  .resource(...)
  .command(...)
  .binding(...)

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

- replace the old `Contract.create(...).operation(...)` fixture path with `Product.create(...).resource(...).command(...)`
- model resources, commands, and bindings as siblings
- preserve field metadata in normalized shape projections
- normalize surface defaults once (`cli`, `docs`, `dashboard`, `agent`, `openapi`)
- keep command execution mode explicit: `remote-http`, `local`, or `hybrid-workflow`
- make generated CLI consume `Capability[]`, not operation-specific records
- keep generated code lowering through public `@lili/core` APIs
- keep the surface manifest and `generate --check` working through the refactor

Verification:

- A workers fixture with one resource operation, `deploy`, `dev`, and one binding normalizes to a stable catalog.
- The generated CLI includes the resource operation plus top-level `deploy` and `dev` commands.
- `dev` is not treated as HTTP-capable; `deploy` remains a hybrid workflow, not a fake resource mutation.
- Field metadata changes affect the catalog digest; source formatting and class instance identity do not.
- `bun run --filter @lili/build check` and `bun run --filter @lili/build test` pass after removing the old operation-contract fixture.

## Phase 3C: OpenAPI projection

Implement OpenAPI as the next real surface after the product schema refactor.

OpenAPI generation consumes:

- normalized HTTP-capable capabilities
- `http.method`, `http.path`, and `http.bind`
- input/output shape JSON Schema
- field metadata for descriptions and `x-lili-*` extensions
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

## Phase 3C-QA: build mutation testing

Set up mutation testing for `@lili/build` using the same local workflow as `@lili/core`.

Implementation requirements:

- add `packages/build/stryker.conf.mjs`
- add `mutate: "stryker run"` to `packages/build/package.json`
- add Stryker/Bun-runner dev dependencies through the existing root workspace catalog
- include `stryker.conf.mjs` in the build package TypeScript config
- mutate implementation modules for catalog normalization, digesting, lints, generators, manifest checks, and product-schema builders
- exclude public barrels, `li-build` CLI wrapper code, packaged skill text, generated fixtures, and tests from mutation input
- start with the same thresholds as core unless the first measured baseline proves a narrower first gate is needed

Verification:

- `bun run --filter @lili/build check` passes with the config included in TypeScript checking.
- `bun run --filter @lili/build mutate` starts Stryker with the Bun test runner and completes an initial report.
- The initial report names surviving mutants that should become focused follow-up tests rather than broad snapshot updates.
- The root workspace remains clean: no duplicate Stryker versions, no package-local lockfile, and no mutation artifacts committed.

## Phase 3D: auth/session catalog and runtime foundation

Implement auth/session in staged slices from `docs/auth-session.md`. Keep the API opt-in and do not create `@lili/auth`.

### Phase 3D-A: env auth and capability requirements

Add catalog support for:

- one auth provider per product
- `Auth.none`, `Auth.apiKey`, and `Auth.bearer`
- token env sources
- product permissions and capability `requires`
- context declarations with explicit flags and env vars
- `SecretString`, `resolveAuth`, `resolveContext`, and `applyAuth` in `@lili/core`
- structured `AUTH_*` errors
- release manifest auth metadata

Verification:

- Env bearer/API key credentials resolve through `SecretString` and never serialize raw values.
- Missing human auth, missing CI token, missing context, and known missing scope produce structured auth envelopes.
- Generated commands add declared context flags and pass resolved credentials into core transport without raw token strings.
- Agent/MCP metadata includes auth requirements/status but no secrets.

### Phase 3D-B: file sessions and context

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

- generated remote wiring calls `serializeHttpOperationRequest` and `callHttpOperation`
- generated auth-aware remote wiring calls `resolveAuth`/`resolveContext` before `callHttpOperation`
- output schema validation treats HTTP responses as untrusted
- non-2xx, malformed JSON, unsupported content types, timeout, missing base URL, and missing auth become structured core errors
- 401/403 responses map to auth errors when an auth requirement is present and to remote HTTP errors otherwise
- `li-build conform` verifies an owned fixture server separately from `generate --check`

Verification:

- Remote serializer tests inspect method, path, query, headers, and body without network.
- Generated remote command tests mock `callHttpOperation`.
- Conformance fixture tests run against a local owned HTTP server.
- Destructive conformance cases skip unless fixture-backed and explicitly opted in.

## Phase 5: releases spine

Implement renderer-neutral release infrastructure before any ecosystem-specific renderer is treated as special. This is the next `@lili/releases` package slice; do not implement npm packaging here except through a test fixture renderer that proves the shared release loop.

### Phase 5A: manifest schema and fixture

Add `zod` to `packages/releases`, then add `packages/releases/src/manifest.ts` with:

- `CliReleaseManifestSchema`
- `parseCliReleaseManifest`
- exported manifest and target types
- one checked-in fixture manifest under `packages/releases/test/fixtures/`

Verification:

- `packages/releases/test/manifest.test.ts` rejects malformed manifests.
- The fixture manifest records metadata, executable metadata, product/catalog provenance, runtime env/config expectations, one conformance-metadata case, at least one glibc and one musl binary, and at least one baseline x64 target.
- `bun run --filter @lili/releases check` proves the exported types compile.

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

### Phase 5D: release package orchestration

Add the orchestration function that validates the manifest, verifies final binaries, resolves renderers, stages renderer outputs, packs final artifacts, and runs final-artifact verifiers. Use a fixture renderer in tests to prove the loop without privileging npm.

Verification:

- `packages/releases/test/release-package.test.ts` proves `renderers: []` still validates the manifest and verifies final binary bytes.
- A fixture renderer receives only the parsed manifest and renderer output context, not product schema files, package workspaces, generated source, or build directories.
- Selecting an invalid renderer fails before any staging directory is created.

### Phase 5E: final artifact verification

Final verification must inspect packed artifacts, not staging directories.

Verification:

- The fixture renderer packs an artifact, records a package artifact record with renderer/ecosystem/kind/sha256/size, the verifier unpacks or reads the packed artifact, and a corrupted packed artifact fails even if the staging directory still looks valid.
- No test should accept "directory contains expected files" as the final proof.

### Phase 5F: manifest-based yank dry run

Add yank planning from one manifest reference. Phase 5 should only produce a dry-run plan; registry mutation and ecosystem-specific publishing behavior stay out of scope.

Verification:

- `packages/releases/test/yank.test.ts` reports every affected package artifact from the manifest.
- The dry run must not require package names or versions that are not derivable from the manifest.

Phase 5 exits only when `bun run --filter @lili/releases check`, `bun run --filter @lili/releases test`, and root `bun run check` pass with no `release-extra` package and no npm-specific renderer implementation.

## Phase 6: renderer implementations

Add ecosystem renderers inside `@lili/releases`. This phase renders and verifies package artifacts; it does not publish them to registries.

- npm umbrella plus platform packages
- PyPI wheels
- Homebrew formula
- Scoop JSON manifest
- WinGet helper flow only when its asynchronous repository workflow is explicitly in scope

Verification:

- Each selected renderer can be tested independently from the same manifest fixture.
- Selecting multiple renderers produces traceable artifacts for the same release version and binary hashes.
- PyPI, Homebrew, and Scoop renderer tests cover ecosystem-specific metadata and final artifact checks, not just generic file emission.
- Yank dry run reports every affected artifact from one manifest reference.

## Phase 7: distribution automation

Automate publishing npm, PyPI, Homebrew, and Scoop outputs from one release manifest after Phase 6 artifact rendering and verification are stable.

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

- A dry-run publish plan lists every registry mutation for npm, PyPI, Homebrew, and Scoop from one manifest reference.
- Missing credentials or required repository settings for a selected publisher fail before any mutation.
- Artifact hash verification runs immediately before publish and refuses stale or mismatched packed artifacts.
- npm publish ordering publishes platform packages before the umbrella package.
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

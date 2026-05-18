# Next implementation plan

This plan starts after the current Bun-native core builder work. It assumes a hard cutover to the target package layout when implementation begins.

## Success criteria

- Root repo is a Bun workspace monorepo.
- Current core behavior lives in `packages/core` with no build or releases dependency.
- `packages/build` owns schema IR, generation, drift checks, compile orchestration, and server conformance.
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
- parser/config/env validation
- formatter and output envelopes
- MCP basics
- skill/docs helpers
- outbound HTTP operation serializer and transport
- JSON envelope support for generated schema-driven commands, including metadata channels for locality

Verification:

- Core parity, golden, contract, property, formatter, MCP, and skill tests pass from `packages/core`. OpenAPI tests move to `@lili/build` when that package's IR-driven generator lands.
- A dependency boundary test proves `@lili/core` does not import `@lili/build` or `@lili/releases`.
- The remote transport pure serializer is testable without network.
- A generated-command fixture can request `--json` and receive a structured envelope, not ad hoc text.

## Phase 2A: agent consistency closure

Close the agent-facing gaps found in the consistency audit before expanding generation:

1. Define the default generated vocabulary: verbs `get`, `list`, `create`, `update`, `delete`, `run`; flags `json`, `local`, `remote`, `force`; forbidden verbs `info`; forbidden flags `format` and `skip-confirmations`.
2. Implement schema lints for vocabulary violations and guarded overrides.
3. Make `--json` the canonical generated CLI machine-output contract. Keep current core `--format` behavior only as handwritten compatibility unless a requirement explicitly promotes it.
4. Make generated built-ins and helper commands honor `--json`.
5. Add locality resolution and output signaling for generated operations.
6. Replace runtime-reflection OpenAPI for schema-driven programs with canonical IR OpenAPI that consumes `remote.bind`.

Verification:

- A fixture operation using `projects info` fails `vocabulary/verb` and recommends `projects get`.
- A fixture option named `skipConfirmations` fails `vocabulary/flag` and recommends `force`.
- A generated command with `--format json` fails or is absent from help; the same command with `--json` succeeds.
- Generated helper commands emit parseable JSON when `--json` is passed.
- Mixed local/remote fixtures reject `--local --remote`, honor flag > config > schema default, and include `meta.locality.mode` plus `meta.locality.source`.
- Generated OpenAPI for a `GET` operation emits path/query/header/body placement from `remote.bind` and excludes local-only operations.

## Phase 3: build vertical slice

Implement the smallest build package slice that proves the architecture:

1. Define runtime schema API and canonical IR normalization.
2. Generate one command tree through `@lili/core` public APIs.
3. Generate deterministic provenance headers.
4. Add `generate --check` for generated-file freshness.
5. Include both a CRUD-like operation and a workflow command in fixtures.

Verification:

- Equivalent handwritten and generated commands return the same output for the same input.
- Canonical IR digest ignores source formatting and excludes raw Zod handles, functions, absolute paths, timestamps, and secrets.
- A hand-edited generated file fails `generate --check`.
- The workflow command is not forced into a resource model or HTTP endpoint.

## Phase 3A: surface graph slice

After one generated command works, make generated outputs explicit and synchronized:

- emit a generated surface manifest for CLI, command manifest, OpenAPI, MCP command tools, Agent Skill/LLM surfaces, docs/reference markdown, and config JSON Schema when configured
- record each surface's source (`canonical-ir` or `openapi`), input digest, generator version, generation options digest, output digest, and relative artifact paths
- keep command MCP tools IR-derived
- reserve OpenAPI-derived downstream surfaces for later adapters such as SDKs, Terraform providers, and Code Mode MCP servers
- reject requested product-specific surfaces such as `wrangler.jsonc`, Workers Binding RPC metadata, dashboard metadata, or generated server/API code unless an explicit adapter requirement exists

Verification:

- Touching any generated surface makes `generate --check` fail with the stale surface ID.
- Two formatted-equivalent schemas produce the same IR-derived surface input digests.
- Changing a generation option changes the affected surface output digest without changing the canonical IR digest.
- A requested unsupported product-specific surface fails with an actionable "adapter not implemented" error instead of silently emitting partial artifacts.

## Phase 4: remote and conformance slice

Prove that generated remote commands and handwritten remote commands share the same core transport:

- generated remote wiring calls `serializeHttpOperationRequest` and `callHttpOperation`
- output schema validation treats HTTP responses as untrusted
- non-2xx, malformed JSON, unsupported content types, timeout, missing base URL, and missing auth become structured core errors
- `li-build conform` verifies an owned fixture server separately from `generate --check`

Verification:

- Remote serializer tests inspect method, path, query, headers, and body without network.
- Generated remote command tests mock `callHttpOperation`.
- Conformance fixture tests run against a local owned HTTP server.
- Destructive conformance cases skip unless fixture-backed and explicitly opted in.

## Phase 5: releases spine

Implement renderer-neutral release infrastructure before any ecosystem-specific renderer is treated as special:

- release manifest schema
- final signed/notarized binary hashing and size verification
- renderer registry
- renderer selection: none, one, many, or all
- staged artifact packing
- final artifact verification
- manifest-based yank dry run

Verification:

- Empty renderer selection still writes and validates a manifest.
- Selecting an unsupported or underconfigured renderer fails before staging artifacts.
- Renderer purity tests run without access to schema source, package workspaces, or build directories except through manifest references.
- Final artifact tests verify packed artifacts, not staging directories.

## Phase 6: renderer implementations

Add ecosystem renderers inside `@lili/releases`:

- npm umbrella plus platform packages
- PyPI wheels
- Homebrew formula
- Scoop JSON manifest
- WinGet helper flow only when its asynchronous repository workflow is explicitly in scope

Verification:

- Each selected renderer can be tested independently from the same manifest fixture.
- Selecting multiple renderers produces traceable artifacts for the same release version and binary hashes.
- Yank dry run reports every affected artifact from one manifest reference.

## Do not start with

- a `release-extra` package
- an npm-only release architecture
- framework-specific Vite/TanStack packages
- a broad OpenAPI importer
- generated docs as a shipped package or command
- product-specific surface adapters without explicit requirements

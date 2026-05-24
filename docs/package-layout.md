# Package layout requirements

This document describes the target rewrite layout. The pre-cutover source was an `incur-bun-native` package imported from upstream; the monorepo cutover replaces that single-package layout with the workspace shape below.

## Target layout

```txt
liche/
  package.json
  bun.lock
  tsconfig.base.json
  README.md
  AGENTS.md

  docs/
    invariant.md
    package-layout.md
    next-plan.md
    application-integration.md
    http-operation-transport.md
    schema-ir-openapi.md
    server-conformance.md
    build-system.md
    distribution.md
    npm-binary-packaging.md
    releases.md
    coverage-current.md
    coverage-rewrite.md
    behavior-plan.md
    AGENTS.md
    log.md
    tests/

  packages/
    core/
    extensions/
    build/
    product/
    releases/

  examples/
    handwritten-cli/
    generated-cli/
    fetch-backed-cli/
    remote-backed-cli/
    vite-tanstack-app/
```

## Workspace policy

Use Bun workspaces for package development.

Use Bun catalogs for shared dependency versions. Shared versions belong at the root; package-local `package.json` files reference them with `catalog:` or a named catalog when that keeps dependency policy clear.

Target root shape:

```json
{
  "private": true,
  "workspaces": {
    "packages": [
      "packages/*"
    ],
    "catalog": {
      "typescript": "^5.9.0",
      "zod": "^4.4.0",
      "tokenx": "^1.3.0",
      "yaml": "^2.9.0"
    },
    "catalogs": {
      "test": {
        "fast-check": "^4.8.0",
        "@stryker-mutator/core": "^9.6.0",
        "@stryker-mutator/typescript-checker": "^9.6.0"
      }
    }
  }
}
```

## Package responsibilities

### `packages/core`

Owns:

- `defineCli()`
- `defineCommand()`
- `.serve()`
- `.fetch()`
- middleware
- observe-only lifecycle events and typed mutation hooks
- parser/config/env validation
- config resolution, file parsing, precedence, and provenance semantics
- formatter/output envelope behavior
- extension protocol and extension merge rules
- MCP basics (`--mcp` runtime support and direct command-contract execution remain core)
- skills/docs basics (core may expose packaged skill content and runtime reflection for handwritten CLIs; installers move to extensions)
- outbound HTTP operation transport
- auth redaction and transport-safety primitives (`SecretString`, non-secret auth metadata, and resolved auth/header application contracts)

Must not depend on `@liche/extensions`, `@liche/build`, `@liche/product`, or `@liche/releases`.

### `packages/extensions`

Owns official optional extension factories over public `@liche/core` lanes:

- config authoring factory
- completions command
- coordinated agent helper bundle
- MCP and skill installer commands
- auth/session workflow extension
- local diagnostics, doctor, support bundle, and telemetry sink adapters

May depend on `@liche/core` through package-root imports only.

Must not import `packages/core/src/*`, mutate `CliState`, or depend on `@liche/build`, `@liche/product`, or `@liche/releases`.

### `packages/build`

This package is intentionally narrow. It is useful only while generic Bun compile/provenance behavior is shared by Product-generated CLIs and handwritten CLIs; it should not grow into a second Product builder.

Owns:

- reusable Bun `Bun.build()` orchestration
- standalone executable compile flag profiles
- build-time constants for release version, contract digest, source commit, and build-tool version
- path-independent `compileFlagsDigest`
- internal compile entrypoint rendering for CLIs
- build metadata useful to release manifests

May depend on `@liche/core` for its developer CLI.

Does not own product schemas, generated surfaces, server conformance, release manifests, or package-manager renderers.

### `packages/product`

Owns:

- runtime product schema authoring API
- general product config declarations that lower into `@liche/core` config
- auth provider, permission, context, and capability requirement declarations
- canonical catalog normalization
- schema lints
- generated CLI source
- generated auth capabilities when opted in
- generated OpenAPI/MCP/docs/Agent Skill/JSON Schema surfaces
- generated surface manifest and surface drift checks
- generated provenance headers
- drift checks
- product-to-compile wrapper that delegates to `@liche/build`
- server conformance against owned HTTP deployments

May depend on `@liche/core` and `@liche/build`.

Does not own outbound HTTP operation transport.

Product-specific surface adapters, such as `wrangler.jsonc` fragments, Workers Binding RPC metadata, dashboard metadata, downstream SDK generation, Terraform providers, or Code Mode MCP servers, remain inside the build surface system unless a later requirement proves a real package boundary. Do not create a first-party package just to hide a generator.

### `packages/releases`

Owns:

- release manifest schema
- non-secret auth/session release metadata
- artifact provenance
- binary verification
- renderer interface
- renderer registry and selection
- npm renderer
- PyPI renderer
- Homebrew renderer
- Scoop renderer
- final package artifact verification
- yank/rollback planning

May consume build output and manifests. Must not reach around the manifest from renderers.

Users select zero to all renderers at release time. Do not create a `release-extra` package; renderer choice is configuration, not a package boundary.

## Examples

Examples must prove the package boundaries:

| Example | Purpose |
|---|---|
| `examples/handwritten-cli` | Uses only `@liche/core`. |
| `examples/generated-cli` | Uses `@liche/product` to generate a CLI from schema. |
| `examples/fetch-backed-cli` | Demonstrates existing inbound/in-process fetch behavior without outbound remote transport confusion. |
| `examples/remote-backed-cli` | Demonstrates core-owned outbound HTTP operation transport, with and without generated wiring. |
| `examples/vite-tanstack-app` | Demonstrates capability-first integration for a web app: product schema, API routes, local handlers, generated CLI, conformance against dev server. |

## Non-package folders

These stay as folders unless a later requirement adds a real package boundary:

- `docs/` (requirements, concepts, api, release, tests, sources, log)
- Vite sanity checks
- test fixtures
- generated artifact snapshots
- package renderer fixtures
- Bun-native rule experiments

## Cutover rule

When implementation begins, prefer a hard cutover over compatibility scaffolding.

Do not create parallel old/new package trees unless there is an explicit migration requirement. The pre-cutover `incur-bun-native` source was useful starting material, not a long-term published package shape for the rewrite.

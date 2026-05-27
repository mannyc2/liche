# Invariants and package layout

This document is the anchor for the liche product boundaries. It describes the product invariants, the workspace shape, and what each package owns before implementation details are allowed to drift.

## Product invariant

```txt
schema is the source of truth
generated surfaces are artifacts
the binary is the product
the manifest is the distribution contract
```

Only four opt-in features sit above the runtime:

1. **Product system** — a runtime product schema that normalizes into a canonical capability catalog and generates the CLI command tree plus OpenAPI, MCP, docs, Agent Skill/LLM surfaces, JSON Schema/config surfaces, drift checks, and server conformance.
2. **Input-source primitive plus config extension** — a Core command-input assembly contract for durable external option values, with generated Product config lowering into the same config provider path.
3. **Build system** — reusable Bun build/compile primitives for standalone executables, including compile flag profiles and path-independent compile provenance. Useful for Product-generated CLIs and handwritten CLIs.
4. **Distribution** — one release manifest, pure package-manager renderers, and final-artifact guard rails.

Everything else is current core runtime behavior unless a requirement document says otherwise.

The canonical catalog is a product capability contract. It models resources, commands, general config declarations, bindings, auth providers, permissions, contexts, field metadata, surface membership, inputs, outputs, effects, examples, and execution wiring. It is not a database model or a license to generate every possible product surface; product-specific surfaces are adapter-gated.

Generated surfaces are a graph, not unrelated emitters. Each generated surface declares its source (`catalog` or `openapi`), generator version, generation options, input digest, output digest, drift check, and owner package. A surface that cannot name those facts is not accepted as part of the build system.

The source graph is:

```txt
canonical catalog
  -> generated CLI
  -> generated OpenAPI
  -> generated MCP command tools
  -> generated Agent Skill/LLM surfaces
  -> generated docs/reference markdown
  -> generated JSON Schema for general config and bindings

generated OpenAPI
  -> later downstream HTTP ecosystem surfaces
```

Product-specific surfaces such as Workers Binding RPC metadata, `wrangler.jsonc` fragments, dashboard metadata, product docs, SDKs, Terraform providers, or Code Mode MCP servers are later surface adapters. They must consume either the canonical catalog or generated OpenAPI through the same surface graph; they must not read schema source, generated CLI source, or package internals directly.

## Workspace layout

```txt
liche/
  package.json
  bun.lock
  tsconfig.base.json
  README.md
  AGENTS.md
  CHANGELOG.md
  ROADMAP.md

  docs/
    AGENTS.md
    invariant.md            (this file)
    api-boundary.md
    application-integration.md
    auth-session.md
    build-system.md
    config-primitive.md
    coverage.md
    distribution.md
    env-vars.md
    error-handling.md
    http-operation-transport.md
    npm-binary-packaging.md
    product-schema.md
    release-and-distribution.md
    schema-ir-openapi.md
    server-conformance.md

  packages/
    core/
    extensions/
    build/
    product/
    releases/

  examples/
    handwritten-cli/
    generated-cli/
    remote-backed-cli/
    vite-tanstack-app/
```

### Workspace policy

Use Bun workspaces for package development. Use Bun catalogs for shared dependency versions. Shared versions belong at the root; package-local `package.json` files reference them with `catalog:` or a named catalog when that keeps dependency policy clear.

Target root shape:

```json
{
  "private": true,
  "workspaces": {
    "packages": ["packages/*"],
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

## Package boundary invariant

Package boundaries must have an opt-in sentence. If a user cannot explain what they give up by not installing a package, that package should be a folder, not a package.

| Package | Required | Purpose | What a user gives up by not installing it |
|---|---:|---|---|
| `@liche/core` | yes | Runtime CLI framework: `defineCli()`, `defineCommand()`, `run(cli)`, `cli.fetch()`, middleware, lifecycle events, mutation hooks, parser/input-source engine, standard formatter, extension protocol, command contracts, packaged skill/docs reflection basics, and outbound HTTP operation transport. | The liche runtime itself, including handwritten CLIs and the shared remote HTTP transport. |
| `@liche/extensions` | no | Official optional extensions over public core lanes: config authoring, completions, agent setup helpers, auth/session workflows, and telemetry adapters. | First-party optional factories and helper workflows. Handwritten core CLIs still run, and Product can still generate catalog-owned surfaces. |
| `@liche/product` | no | Opt-in Product schema authoring, catalog linting, generated CLI/OpenAPI/MCP/docs/Agent Skill surfaces, drift checks, and server conformance. | Product-driven generation and conformance. Handwritten CLIs still work. |
| `@liche/build` | no | Reusable Bun build/compile primitives for standalone executables, compile flag profiles, and path-independent compile provenance. | liche's compile wrapper and compile provenance. They can still call `bun build --compile` manually. |
| `@liche/releases` | yes | Release manifest schema, binary provenance, artifact verification, renderer interface, selectable package-manager renderers, and yank/rollback planning. | Manifest-based distribution, package-manager wrapper generation, and final-artifact guard rails. They can still build binaries manually. |

No packages beyond `@liche/extensions` exist for Vite, docs, testkit, Bun-native lint rules, adapters, or package-manager renderers. Renderer choice lives inside `@liche/releases` configuration, not in separate first-party packages.

### `packages/core` responsibilities

Owns:

- `defineCli()`, `defineCommand()`, `run(cli)`, `cli.fetch()`
- middleware
- observe-only lifecycle events and typed mutation hooks
- parser/config/env validation
- config resolution, file parsing, precedence, and provenance semantics
- formatter/output envelope behavior
- extension protocol and extension merge rules
- command reflection helpers consumed by MCP and skill adapters
- skills/docs basics (packaged skill content and runtime reflection for handwritten CLIs; installers live in extensions)
- outbound HTTP operation transport
- redaction and transport primitives (`SecretString` plus generic HTTP auth header contracts)

Must not depend on `@liche/extensions`, `@liche/build`, `@liche/product`, or `@liche/releases`.

### `packages/extensions` responsibilities

Owns official optional extension factories over public `@liche/core` lanes:

- config authoring factory
- completions command
- coordinated agent helper bundle
- MCP and skill installer commands
- auth/session workflow extension
- telemetry sink adapters

May depend on `@liche/core` through package-root imports only. Must not import `packages/core/src/*`, mutate `CliState`, or depend on `@liche/build`, `@liche/product`, or `@liche/releases`.

### `packages/build` responsibilities

Intentionally narrow. Useful only while generic Bun compile/provenance behavior is shared by Product-generated CLIs and handwritten CLIs; should not grow into a second Product builder.

Owns:

- reusable `Bun.build()` orchestration
- standalone executable compile flag profiles
- build-time constants for release version, contract digest, source commit, and build-tool version
- path-independent `compileFlagsDigest`
- internal compile entrypoint rendering for CLIs
- build metadata useful to release manifests

May depend on `@liche/core` for its developer CLI. Does not own product schemas, generated surfaces, server conformance, release manifests, or package-manager renderers.

### `packages/product` responsibilities

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

May depend on `@liche/core` and `@liche/build`. Does not own outbound HTTP operation transport.

Product-specific surface adapters (e.g., `wrangler.jsonc` fragments, Workers Binding RPC metadata, dashboard metadata, downstream SDK generation, Terraform providers, Code Mode MCP servers) remain inside the build surface system unless a later requirement proves a real package boundary. Do not create a first-party package just to hide a generator.

### `packages/releases` responsibilities

Owns:

- release manifest schema
- non-secret auth/session release metadata
- artifact provenance
- binary verification
- renderer interface, registry, and selection
- npm, PyPI, Homebrew, and Scoop renderers
- final package artifact verification
- yank/rollback planning

May consume build output and manifests. Must not reach around the manifest from renderers. Users select zero to all renderers at release time. Do not create a `release-extra` package; renderer choice is configuration, not a package boundary.

## Core, Product, and extension standard

### Belongs in `@liche/core`

Core owns the runtime contract required by both handwritten and generated CLIs:

- command declaration, parsing, validation, execution, middleware, lifecycle events, mutation hooks, and structured errors
- args/options/env/config loading, value provenance, and the standard result/error envelope
- standard output formats: JSON, JSONL, YAML, and Markdown
- stable serializable command contract data needed for help, manifests, schema export, and first-party adapters
- input-source provenance, redaction, and outbound HTTP transport primitives that generated and handwritten commands call at runtime
- serializable command reflection helpers that adapters can consume without importing internals

A feature belongs in core only when a CLI cannot keep the same basic command semantics without it, or when putting it outside core would duplicate parser/executor/security/provenance behavior. Core APIs must be source-of-truth primitives, not convenience workflows.

### Does not belong in `@liche/core`

These are optional extensions/adapters, even when they are useful first-party workflows:

- nonessential output renderers and export formats beyond the standard machine/human envelope
- agent/vendor publishing workflows, including `mcp add` and `skills add`
- auth/session workflows such as credential resolution, session storage, OAuth device login, identity probing, and generated auth command factories
- config mutation UX such as `config set`, `config edit`, and comment-preserving writes
- hosted/export telemetry sinks, Product-generated diagnostics, and hosted ingestion clients
- release, build, Product surface, server adapter, dashboard, SDK, Terraform, or framework-specific behavior

Command-shaped helpers register through extensions as normal commands, must stay disabled unless requested by the CLI author, and must not pull in broader vendor publishing adapters.

### Belongs in `@liche/product`

Product owns the catalog compiler and generated-surface graph:

- product schema authoring APIs for products, resources, commands, bindings, general config, auth providers, permissions, contexts, effects, policy, examples, and surface membership
- deterministic catalog normalization, lints, digests, vocabulary policy, and generated-surface manifests
- generated CLI source that lowers through public `@liche/core` APIs
- generated OpenAPI, MCP command tools, docs/reference markdown, Agent Skill/LLM surfaces, config JSON Schema, and drift checks
- server conformance against owned HTTP deployments
- Product-to-build orchestration that delegates compile mechanics to `@liche/build`

Product does not own command execution, parser behavior, runtime config loading, session storage, auth header application, outbound HTTP transport semantics, binary compile mechanics, or package-manager release rendering. Those remain core, build, or release concerns.

### Extension and adapter standard

An extension must declare exactly which stable source it consumes:

- `CommandContract` for handwritten CLI projections or runtime command adapters
- `Catalog` for Product-owned generated surfaces
- generated `OpenAPI` for downstream HTTP ecosystem surfaces
- release manifests and build records for distribution adapters

Extensions must not import package internals, inspect raw schema source, read generated CLI source, depend on `CliState`/`Entry`, or register behavior by mutating hidden runtime state. They may contribute behavior only through public core lanes: command registration, lifecycle events, mutation hooks, documented config declarations, or generated artifacts with drift checks.

Extensions also need a disabled-state test: turning the extension off must leave command execution, JSON/JSONL output, config provenance, structured errors, auth/session resolution, and outbound HTTP transport semantics unchanged.

The core extension-lane property test (`packages/core/test/extension-lane-coverage.test.ts`) makes this standard executable for core-level proposals. If the test can express the candidate as a package-root extension, the candidate stays outside core. If it cannot, the public API widening must be framed as a reusable lane rather than a one-off helper.

Do not create a catch-all package unless its opt-in sentence is concrete. "Official optional adapters over stable liche contracts" is a valid package thesis; "miscellaneous things not in core" is not.

## Execution direction invariant

The runtime has multiple execution directions. They must be named separately.

| Direction | Owner | Meaning |
|---|---|---|
| argv CLI runner | `@liche/core` | `run(cli, argv?)` parses command-line input, executes one selected command, writes output, and exits or returns. It is not an HTTP server. |
| inbound HTTP handler | `@liche/core` | `.fetch(request)` receives HTTP requests and dispatches them to registered commands. It also exposes core reflection endpoints such as MCP and schema/manifest surfaces for handwritten CLIs. |
| outbound HTTP operation transport | `@liche/core` | A command can call a configured remote HTTP API, parse the response, validate it against the output schema, and map failures into the standard error envelope. |
| generated command wiring | `@liche/product` | Generated code wires resource operations and commands into core runtime primitives. It does not own transport semantics. |

The word `remote` in the schema means outbound HTTP operation transport. It is not a synonym for `.fetch()`.

## Source-of-truth precedence

For handwritten CLIs, core reflection is the source for command schema, MCP tools, and skill/docs helpers.

For schema-driven CLIs, the normalized catalog is the source of truth. Generated CLI code registers commands into core, and generated byproduct surfaces come from the canonical catalog.

Core reflection must be explicitly scoped as runtime reflection for handwritten CLIs or as a compatibility view over generated registrations. It must not silently compete with schema-generated OpenAPI, MCP, docs, or Agent Skill output.

OpenAPI-derived downstream surfaces have a different source of truth from catalog-derived command surfaces. Command MCP tools for the generated CLI come from the canonical catalog. A future Code Mode MCP server that models the HTTP API ecosystem may consume generated OpenAPI. These are separate surfaces and must not silently overwrite each other.

## Non-goals

```txt
no Vite package
no Vite plugin
no Vite adapter
no browser client generator
no contract-vs-server file split
no arbitrary OpenAPI importer
no shipped docs package
no `li docs` command
no testkit package
no bun-native rules package
no release-extra package
no package without an opt-in sentence
no per-capability auth provider selection unless a concrete use case requires it
no generated server/API implementation unless an explicit adapter requirement exists
no assumption that every command is CRUD, HTTP-backed, table-shaped, or resource-derived
```

OpenAPI is output, not input. Importing arbitrary OpenAPI specifications into a liche schema is a later adapter track.

The primary target is owned product capability catalogs:

```txt
schema = source of truth for resources, commands, bindings, and HTTP-backed capabilities the user owns
CLI = generated interface to user-invokable capabilities
OpenAPI = generated HTTP projection of HTTP-backed capabilities
remote-http = external HTTP deployment of a capability
local = local handler implementation of a command or local capability
hybrid-workflow = handler that may do local work and call APIs
```

External means outside the CLI process. It does not mean third-party by default.

## Determinism invariant

Generated artifacts must be deterministic:

```txt
same canonical catalog
same generator version
same generation options
= same generated output
```

Provenance digests must be computed over the normalized catalog, not the raw schema source file. Source formatting should not change the digest unless it changes normalized behavior.

## Build and release ordering

Build, signing, hashing, manifest creation, package rendering, and verification must happen in this order:

```txt
normalize product schema catalog
generate artifacts
compile binary through @liche/build, or compile a handwritten CLI entrypoint directly through @liche/build
sign final binary, when configured
notarize final binary, when configured
verify signature
hash final binary bytes
write release manifest
render package-manager artifacts from manifest
pack final artifacts
verify final artifacts against manifest
publish
```

Never hash unsigned bytes for a signed release. Signing mutates the binary.

## Examples policy

Examples must prove the package boundaries:

| Example | Purpose |
|---|---|
| `examples/handwritten-cli` | Uses only `@liche/core`. |
| `examples/generated-cli` | Uses `@liche/product` to generate a CLI from schema. |
| `examples/remote-backed-cli` | Demonstrates core-owned outbound HTTP operation transport, with and without generated wiring. |
| `examples/vite-tanstack-app` | Demonstrates capability-first integration for a web app: product schema, API routes, local handlers, generated CLI, conformance against dev server. |

## Documentation rule

See [AGENTS.md](./AGENTS.md) for the docs contribution guide.

Tests must be derived from requirements, decision records, external docs, independent oracles, or explicit user instructions. Do not derive new tests from current implementation behavior unless the requirement says the current behavior is the requirement.

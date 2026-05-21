# Rewrite invariant

This document is the anchor for the lili rewrite. It describes the product boundaries before implementation details are allowed to drift.

## Product invariant

```txt
schema is the source of truth
generated surfaces are artifacts
the binary is the product
the manifest is the distribution contract
```

Only four opt-in features are being added:

1. Product system: a runtime product schema that normalizes into a canonical capability catalog and generates the CLI command tree plus OpenAPI, MCP, docs, Agent Skill/LLM surfaces, JSON Schema/config surfaces, drift checks, and server conformance.
2. Config primitive: a first-class, opt-in core config contract for durable non-secret CLI preferences, with generated Product config lowering into the same primitive.
3. Build system: reusable Bun build/compile primitives for standalone executables, including compile flag profiles and path-independent compile provenance. This is useful for Product-generated CLIs and handwritten CLIs.
4. Distribution: one release manifest, pure package-manager renderers, and final-artifact guard rails.

Everything else remains current core runtime behavior unless a requirement document says otherwise.

The canonical catalog is a product capability contract. It models resources, commands, general config declarations, bindings, auth providers, permissions, contexts, field metadata, surface membership, inputs, outputs, effects, examples, and execution wiring. It is still not a database model or a license to generate every possible product surface in MVP; product-specific surfaces remain adapter-gated.

Generated surfaces must be treated as a graph, not as unrelated emitters. Each generated surface declares its source (`catalog` or `openapi`), generator version, generation options, input digest, output digest, drift check, and owner package. A surface that cannot name those facts is not accepted as part of the build system.

The MVP source graph is:

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

## Package boundary invariant

Package boundaries must have an opt-in sentence. If a user cannot explain what they give up by not installing a package, that package should be a folder, not a package.

| Package | Required | Purpose | What a user gives up by not installing it |
|---|---:|---|---|
| `@lili/core` | yes | Runtime CLI framework: `Cli.create()`, `.command()`, `.serve()`, `.fetch()`, middleware, lifecycle events, mutation hooks, parser, formatter, opt-in config primitive, MCP basics, skills basics, and outbound HTTP operation transport. | They give up the lili runtime itself, including handwritten CLIs, typed config, and the shared remote HTTP transport. |
| `@lili/product` | no | Opt-in Product schema authoring, catalog linting, generated CLI/OpenAPI/MCP/docs/Agent Skill surfaces, drift checks, and server conformance. | They give up Product-driven generation and conformance. Handwritten CLIs still work. |
| `@lili/build` | no | Reusable Bun build/compile primitives for standalone executables, compile flag profiles, and path-independent compile provenance. | They give up lili's compile wrapper and compile provenance. They can still call `bun build --compile` manually. |
| `@lili/releases` | yes | Release manifest schema, binary provenance, artifact verification, renderer interface, selectable package-manager renderers, and yank/rollback planning. | They give up manifest-based distribution, package-manager wrapper generation, and final-artifact guard rails. They can still build binaries manually. |

Do not create MVP packages for Vite, docs, testkit, Bun-native lint rules, adapters, or package-manager renderers. Renderer choice belongs inside `@lili/releases` configuration, not in separate first-party packages.

## Execution direction invariant

The current core has multiple execution directions. The rewrite must name them separately.

| Direction | Owner | Meaning |
|---|---|---|
| argv CLI runner | `@lili/core` | `.serve(argv)` parses command-line input, executes one selected command, writes output, and exits or returns. It is not an HTTP server. |
| inbound HTTP handler | `@lili/core` | `.fetch(request)` receives HTTP requests and dispatches them to registered commands. It also exposes core reflection endpoints such as MCP and schema/manifest surfaces for handwritten CLIs. |
| in-process fetch-backed command | `@lili/core` | A command can delegate to a provided `FetchHandler`. This is an in-process Request/Response bridge, not a hosted backend client. |
| outbound HTTP operation transport | `@lili/core` | A command can call a configured remote HTTP API, parse the response, validate it against the output schema, and map failures into the standard error envelope. |
| generated command wiring | `@lili/product` | Generated code wires resource operations and commands into core runtime primitives. It does not own transport semantics. |

The word `remote` in the schema means outbound HTTP operation transport. It is not a synonym for `.fetch()`.

## Source-of-truth precedence

For handwritten CLIs, core reflection is the source for command schema, MCP tools, and skill/docs helpers.

For schema-driven CLIs, the normalized catalog is the source of truth. Generated CLI code registers commands into core, and generated byproduct surfaces come from the canonical catalog.

Core reflection must be explicitly scoped as runtime reflection for handwritten CLIs or as a compatibility view over generated registrations. It must not silently compete with schema-generated OpenAPI, MCP, docs, or Agent Skill output.

OpenAPI-derived downstream surfaces have a different source of truth from catalog-derived command surfaces. Command MCP tools for the generated CLI come from the canonical catalog. A future Code Mode MCP server that models the HTTP API ecosystem may consume generated OpenAPI. These are separate surfaces and must not silently overwrite each other.

## Non-goals

These are explicit non-goals for the MVP:

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

OpenAPI is output, not input. Importing arbitrary OpenAPI specifications into an lili schema is a later adapter track.

The primary MVP targets owned product capability catalogs:

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
compile binary through @lili/build, or compile a handwritten CLI entrypoint directly through @lili/build
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

## Documentation rule

See `docs/AGENTS.md` for the reading order and update workflow.

Tests must be derived from requirements, decision records, external docs, independent oracles, or explicit user instructions. Do not derive new tests from current implementation behavior unless the requirement says the current behavior is the requirement.

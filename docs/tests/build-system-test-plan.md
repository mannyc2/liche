# Test plan: build system

Authoritative sources: `docs/product-schema.md`, `docs/build-system.md`, `docs/coverage-rewrite.md`.

## Priority order

1. Core package boundary.
2. Product package schema normalization and canonical catalog digest.
3. Schema lints.
4. Generated command tree through public core APIs.
5. Core-owned remote transport.
6. Server conformance against owned HTTP deployments.
7. Generated surface manifest and drift checks.
8. Generated surfaces.
9. Product package mutation testing.
10. Generic build compile command.

## First vertical slice

The first useful slice should prove:

- a handwritten core CLI still works without product/build packages
- a schema normalizes into a deterministic catalog
- one generated command registers through `Cli.create().command()`
- generated and handwritten command outputs match for the same input
- fixtures include both CRUD-like commands and workflow commands

Do not start with OpenAPI, package rendering, or a broad generator framework.

## Product schema refactor slice

Before implementing OpenAPI, refactor `@lili/product` around product-schema authoring:

- `Product.create()` with sibling resources, commands, and bindings
- static class helpers for `Field`, `Shape`, and `Command`
- normalized `Catalog` and flattened `Capability[]`
- first-class field metadata in shape projections
- normalized surface defaults for CLI, docs, dashboard, agent, and OpenAPI
- generated CLI consumes flattened capabilities instead of operation-only records

Verification fixtures should include one Workers-style product with a resource operation, `deploy`, `dev`, and a binding. The old `Contract.create(...).operation(...)` fixture should not remain as the primary generated surface fixture after the hard cutover.

## Surface graph slice

The surface graph slice should prove:

- generated CLI, command manifest, OpenAPI, MCP command tools, Agent Skill/LLM surfaces, docs/reference markdown, and config JSON Schema all appear in one surface manifest when enabled
- each surface record includes source, input digest, generator version, generation options digest, output digest, and relative artifact paths
- `generate --check` reports the stale surface ID when any generated artifact is hand-edited
- command MCP tools are catalog-derived, while future Code Mode MCP remains an OpenAPI-derived downstream surface
- requesting an unsupported product-specific adapter such as `wrangler.jsonc`, Workers Binding RPC metadata, dashboard metadata, or generated server/API code fails clearly

## Remote slice

The remote slice should prove:

- handwritten CLI can call core transport
- generated CLI can call the same transport
- output schema validates an untrusted HTTP response
- non-2xx and malformed responses become structured errors

This is the hardest runtime boundary and should not be left to documentation-only tests.

## Application integration slice

The app integration slice should prove:

- a Vite/TanStack-style fixture app defines product capabilities rather than deriving commands from UI routes
- the fixture app implements matching API routes and local handlers manually
- generated CLI calls the fixture app through core HTTP operation transport
- conformance passes against the fixture dev server
- generated OpenAPI places path/query/header/body fields according to HTTP binding metadata
- a workflow command in the fixture remains first-class and is not modeled as a CRUD resource or default OpenAPI endpoint

## Conformance slice

The conformance slice should prove:

- `generate --check` runs without a server
- `conform` requires a base URL or target
- read-only examples run against a fixture server
- destructive capabilities are skipped unless explicitly fixture-backed
- schema-invalid successful responses fail conformance

## Mutation testing slice

The Product mutation testing slice should prove:

- `@lili/product` has the same package-local `mutate` workflow shape as `@lili/core`
- Stryker uses the Bun runner and TypeScript checker from the root workspace catalog
- mutation input is limited to implementation modules, not public barrels, CLI wrappers, skill text, generated fixtures, or tests
- `bun run --filter @lili/product check` typechecks the Stryker config
- `bun run --filter @lili/product mutate` completes an initial report and does not commit mutation output artifacts

## Compile slice

The compile slice should prove:

- `@lili/build` constructs a plain compile flag profile, then derives both `Bun.build()` options and `compileFlagsDigest` from that profile
- `@lili/build` has no dependency on `@lili/product` or `@lili/releases`
- local paths, temp directories, output paths, metafile paths, and build logs do not affect `compileFlagsDigest`
- compile writes an internal entrypoint that imports the generated CLI and calls `cli.serve(process.argv.slice(2))`
- `Bun.build()` is injected in tests so profile construction and error handling are verified without compiling a real binary on every unit-test run
- `@lili/releases` remains outside this path and consumes only final binary facts plus the compile flag digest

# Test plan: build system

Authoritative sources: `docs/build-system.md`, `docs/coverage-rewrite.md`.

## Priority order

1. Core package boundary.
2. Canonical IR normalization and digest.
3. Schema lints.
4. Generated command tree through public core APIs.
5. Core-owned remote transport.
6. Server conformance against owned HTTP deployments.
7. Generated surface manifest and drift checks.
8. Generated surfaces.
9. Compile command.

## First vertical slice

The first useful slice should prove:

- a handwritten core CLI still works without build
- a schema normalizes into IR
- one generated command registers through `Cli.create().command()`
- generated and handwritten command outputs match for the same input
- fixtures include both CRUD-like commands and workflow commands

Do not start with OpenAPI, package rendering, or a broad generator framework.

## Surface graph slice

The surface graph slice should prove:

- generated CLI, command manifest, OpenAPI, MCP command tools, Agent Skill/LLM surfaces, docs/reference markdown, and config JSON Schema all appear in one surface manifest when enabled
- each surface record includes source, input digest, generator version, generation options digest, output digest, and relative artifact paths
- `generate --check` reports the stale surface ID when any generated artifact is hand-edited
- command MCP tools are IR-derived, while future Code Mode MCP remains an OpenAPI-derived downstream surface
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

- a Vite/TanStack-style fixture app defines operations rather than deriving commands from UI routes
- the fixture app implements matching API routes manually
- generated CLI calls the fixture app through core HTTP operation transport
- conformance passes against the fixture dev server
- generated OpenAPI places path/query/header/body fields according to `remote.bind`
- a workflow command in the fixture remains first-class and is not modeled as a CRUD resource or HTTP endpoint

## Conformance slice

The conformance slice should prove:

- `generate --check` runs without a server
- `conform` requires a base URL or target
- read-only examples run against a fixture server
- destructive operations are skipped unless explicitly fixture-backed
- schema-invalid successful responses fail conformance

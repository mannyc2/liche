# Liche examples

These examples are source-checkout examples. Run commands from the repository root so Bun can resolve the workspace packages.

## Product Workers

`examples/product-workers` shows the current product-schema path:

- resource operation: `script list`
- hybrid workflow command: `deploy`
- local command: `dev`
- config fields: `apiBaseUrl`, `accountId`
- platform binding: `kv_namespaces`
- generated diagnostics: `doctor`, `catalog`, `notices`, `telemetry`
- fixture-server conformance for `script list`
- generated CLI, OpenAPI, command manifest, MCP tools, agent reference, docs reference, and config schema

## Product Auth Context

`examples/product-auth-context` shows generated auth/context metadata and runtime resolution:

- bearer token from `ACME_TOKEN`
- CI-only token from `ACME_CI_TOKEN`
- org context from `--org` or `ACME_ORG_ID`
- remote base URL from `ACME_API_BASE_URL`
- agent-visible remote command metadata

The command resolves credential/context inputs before using the shared core HTTP transport.

## Product Auth Session

`examples/product-auth-session` shows generated OAuth device auth and file-backed session commands:

- `login`
- `switch`
- `whoami`
- `logout`
- profile-backed context selection with a temp `LICHE_HOME`

## Core Handwritten

`examples/core-handwritten` shows the runtime framework without product generation:

- `defineCli()` / `defineCommand()`
- typed args/options/env
- CLI-wide globals via `defineGlobal()`
- middleware state
- lifecycle events
- opt-in helper commands from `@liche/extensions`

## Release Renderers

`examples/release-renderers` shows `@liche/releases` consuming a build record and a verified final binary path to render package-manager artifacts. It uses a tiny fixture file as the verified binary because renderers verify bytes and stage wrappers; they do not execute the binary.

## CI Release Repo

`examples/ci` is a minimal production-shaped repository for a remote HTTP-backed handwritten CLI. It includes `package.json`, `tsconfig.json`, `src/cli.ts`, `shipyard.jsonc`, `liche.releases.json`, and a compile-plan smoke through `@liche/build`.

## Smoke tests

```sh
bun run examples:smoke
```

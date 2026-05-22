# Lili examples

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
- agent-visible remote command metadata

The command still reaches `REMOTE_NOT_IMPLEMENTED` after auth/context resolution because this example focuses on credential/context resolution rather than a configured remote base URL.

## Product Auth Session

`examples/product-auth-session` shows generated OAuth device auth and file-backed session commands:

- `login`
- `switch`
- `whoami`
- `logout`
- profile-backed context selection with a temp `LILI_HOME`

## Core Handwritten

`examples/core-handwritten` shows the runtime framework without product generation:

- `defineCli()` / `defineCommand()`
- typed args/options/env
- middleware state
- lifecycle events
- opt-in helper builtins

## Release Renderers

`examples/release-renderers` shows `@lili/releases` consuming a build record and a verified final binary path to render package-manager artifacts. It uses a tiny fixture file as the verified binary because renderers verify bytes and stage wrappers; they do not execute the binary.

## CI Release Repo

`examples/ci` is a minimal production-shaped repository for a remote HTTP-backed handwritten CLI. It includes `package.json`, `tsconfig.json`, `src/cli.ts`, `shipyard.jsonc`, `lili.releases.json`, and a compile-plan smoke through `@lili/build`.

## Smoke tests

```sh
bun run examples:smoke
```

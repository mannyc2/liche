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
- Core-backed validation envelopes and field paths

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
- source-aware validation for argv flags, positional args, and env
- CLI-wide globals via `defineGlobal()`
- middleware state
- lifecycle events
- opt-in helper commands from `@liche/extensions`

Try the invalid style case to see the human renderer point at the exact flag:

```sh
bun examples/core-handwritten/cli.ts summarize README.md --style verbose
```

## Core SQLite Bookmarks

`examples/core-sqlite-bookmarks` shows raw `@liche/core` with `bun:sqlite`:

- middleware owns a real resource — opens a `Database`, runs the schema migration, stashes the handle on `ctx.var.db`, and closes it in `finally`
- hermetic env: every command declares `BOOKMARKS_DB` in its `env` schema; the middleware reads `ctx.env.BOOKMARKS_DB`, so `run()` is fully driven by injected input
- `fail({ code, message })` for domain errors (`bookmark.duplicate`, `bookmark.not_found`)
- `--json` always emits the `{ ok, data, error }` envelope, including on failure

```sh
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts add https://bun.sh --title Bun --tags runtime,docs --json
```

## Release Renderers

`examples/release-renderers` shows `@liche/releases` consuming a build record and a verified final binary path to render package-manager artifacts. It uses a tiny fixture file as the verified binary because renderers verify bytes and stage wrappers; they do not execute the binary.

## CI Release Repo

`examples/ci` is a minimal production-shaped repository for a remote HTTP-backed handwritten CLI. It includes `package.json`, `tsconfig.json`, `src/cli.ts`, `shipyard.jsonc`, `liche.releases.json`, and a compile-plan smoke through `@liche/build`.

## Smoke tests

```sh
bun run examples:smoke
```

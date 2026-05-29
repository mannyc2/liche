# Core SQLite bookmarks CLI example

This example uses `@liche/core` directly with `bun:sqlite`. It shows how middleware
can own a real resource (a `Database` handle) while command handlers stay pure.

## What it demonstrates

- **Middleware owns the resource.** A single CLI-wide middleware opens the
  `Database`, runs the schema migration, stashes the handle on `ctx.var.db`, and
  closes it in `finally`. Handlers never open or close the connection — they read
  `ctx.var.db` and run queries.
- **Hermetic env.** Every command declares `BOOKMARKS_DB` in its `env` schema. The
  middleware reads `ctx.env.BOOKMARKS_DB`, so which file is touched is decided
  entirely by the injected input — `run(cli, argv, { env })` is the only knob.
  Nothing reads `Bun.env` or `process.env` underneath.
- **Domain errors via `fail()`.** Duplicate URLs and unknown ids return
  `fail({ code, message })` with stable codes (`bookmark.duplicate`,
  `bookmark.not_found`) instead of throwing.
- **`--json` always emits the `{ ok, data, error }` envelope**, including on
  failure, with a non-zero exit code.

## Run commands

```sh
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts add https://bun.sh --title Bun --tags runtime,docs --json
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts add https://zod.dev --tags docs --json
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts list --json
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts list --tag runtime --json
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts remove 1 --json
```

Adding the same URL twice surfaces the domain error while keeping the envelope:

```sh
BOOKMARKS_DB=/tmp/bookmarks.sqlite bun examples/core-sqlite-bookmarks/cli.ts add https://bun.sh --json
# { "ok": false, "data": null, "error": { "code": "bookmark.duplicate", ... } }
```

Help, version, and reflection commands do not declare `BOOKMARKS_DB`, so the
middleware skips acquiring the database for them:

```sh
bun examples/core-sqlite-bookmarks/cli.ts --help
```

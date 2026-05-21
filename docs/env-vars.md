# Environment Variables

`lili` exposes env vars to commands through two distinct channels. Use the right one for the job.

## Two channels

### 1. `optionEnv` — env-backed option defaults

Use when an env var should act as the **default value for a CLI option**, overridable on the command line.

```ts
cli.command('serve', {
  options: z.object({
    port: z.coerce.number().default(3000),
    token: z.string(),
  }),
  optionEnv: { port: 'MYAPP_PORT', token: 'MYAPP_TOKEN' },
  run: ({ options }) => { /* options.port, options.token */ },
})
```

Help output annotates each bound option:

```
Options:
  --port    server port (default: 3000) (env: MYAPP_PORT)
  --token                                (env: MYAPP_TOKEN)
```

### 2. `env` — validated env schema on `context.env`

Use when a handler genuinely needs the env value as **env**, not as an option (e.g., secrets passed through, ambient config never exposed as a flag).

```ts
cli.command('publish', {
  env: z.object({ NPM_TOKEN: z.string() }),
  run: ({ env }) => { /* env.NPM_TOKEN, validated */ },
})
```

Missing required keys produce a structured validation error.

## Precedence

For options, the resolution order is:

```
argv flag > optionEnv > config file > schema default
```

Env values arrive as strings. Coerce in the options schema with `z.coerce.number()`, `z.stringbool()`, etc. — the same shape you already need for argv-supplied values.

The first-class config primitive target expands the middle of this chain without changing the env boundary:

```txt
argv flag > optionEnv > session/profile runtime defaults > project config > user config > schema default
```

Env-backed option defaults remain `optionEnv`; durable non-secret preferences move through `ctx.config`; auth/session state remains on the auth/session path. See `docs/config-primitive.md` for the target config contract.

## Reading env vars

Inside `src/`, the only sanctioned reader is `bunEnv()` from `src/runtime/bun.ts`. Do not call `process.env`, `Bun.env`, or `import.meta.env` directly. A `test/env-conventions.test.ts` guard enforces this.

Handlers never call `bunEnv()` — they receive env through `context.env` (validated) or through `options` (via `optionEnv`).

## `.env` files

During development (`bun run`), Bun auto-loads `.env`, `.env.local`, and `.env.${NODE_ENV}` before the binary starts. No dotenv setup required. Use `--env-file` or `--no-env-file` on the `bun` command to override loading.

## Compiled binaries

Standalone executables produced by `bun build --compile` behave differently from `bun run`:

- `.env` autoload is **disabled** in release builds (`--no-compile-autoload-dotenv`). A compiled CLI must read env from the process environment only, never from an ambient `.env` next to the working directory. See `docs/build-system.md` for the full compile flag rationale.
- `bunfig.toml` autoload is **disabled** in release builds (`--no-compile-autoload-bunfig`). Bun runtime config must not be inherited from the invoking project.
- `tsconfig.json` and `package.json` autoload remain disabled (Bun's default for compiled binaries). The bundler already consumed them at build time.
- `BUN_OPTIONS` is honored at runtime (e.g. `BUN_OPTIONS="--cpu-prof" ./acme ...`). This is a profiling/debug escape hatch, not a configuration channel.
- `BUN_BE_BUN=1` makes the binary impersonate the `bun` CLI itself. This is an upstream Bun feature; document it as a known runtime behavior. Schema-driven code does not execute in this mode.

Schema-declared env vars (via `optionEnv` or `env`) are read directly from the process environment and are unaffected by autoload toggles.

## Auth/session env vars

Auth/session generated CLIs add a stricter env contract:

- token env vars such as `ACME_TOKEN` and `ACME_API_KEY` are read by `resolveAuth`, wrapped in `SecretString`, and never exposed in command output, logs, MCP metadata, conformance reports, or release manifests
- context env vars such as `ACME_ORG_ID` and `ACME_PROJECT_ID` are non-secret scoping values and may appear in redacted status metadata when useful
- profile selection may use `<PRODUCT_ENV_PREFIX>_PROFILE`
- raw secret CLI flags such as `--token`, `--api-key`, or `--auth-env NAME=VALUE` are not the primary generated path and must not be emitted by default

Credential resolution order and generated flags are defined in `docs/auth-session.md`.

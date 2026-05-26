# Environment Variables

`liche` exposes env vars to commands through two distinct channels. Use the right one for the job.

## Two channels

### 1. `input.sources` — env-backed option values

Use when an env var should act as the **default value for a CLI option**, overridable on the command line.

```ts
import { defineCli, defineCommand, z } from "@liche/core";

export const cli = defineCli({
  name: "myapp",
  commands: [
    defineCommand({
      path: ["serve"],
      input: {
        options: z.object({
          port: z.number().default(3000),
          token: z.string(),
        }),
        sources: {
          options: {
            port: [{ provider: "env", path: "MYAPP_PORT" }],
            token: [{ provider: "env", path: "MYAPP_TOKEN" }],
          },
        },
      },
      run: ({ input }) => { /* input.options.port, input.options.token */ },
    }),
  ],
});
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
defineCommand({
  path: ["publish"],
  input: {
    env: z.object({ NPM_TOKEN: z.string() }),
  },
  run: ({ input }) => { /* input.env.NPM_TOKEN, validated */ },
});
```

Missing required keys produce a structured validation error.

## Precedence

For options, the resolution order is:

```
argv flag > declared sources in order > schema default
```

Env values arrive as strings from the built-in `env` provider. Core applies narrow schema-directed primitive coercion for provider values before validating final options, so `"3001"` can satisfy `z.number()` and `"true"` / `"false"` can satisfy `z.boolean()`. Auth/session state remains on the auth/session path. See `docs/config-primitive.md` for the config provider contract.

## Reading env vars

Inside `src/`, the only sanctioned reader is `bunEnv()` from `src/runtime/bun.ts`. Do not call `process.env`, `Bun.env`, or `import.meta.env` directly. A `test/env-conventions.test.ts` guard enforces this.

Handlers never call `bunEnv()` — they receive env through `context.env` (validated) or through `options` (via declared input sources).

## `.env` files

During development (`bun run`), Bun auto-loads `.env`, `.env.local`, and `.env.${NODE_ENV}` before the binary starts. No dotenv setup required. Use `--env-file` or `--no-env-file` on the `bun` command to override loading.

## Compiled binaries

Standalone executables produced by `bun build --compile` behave differently from `bun run`:

- `.env` autoload is **disabled** in release builds (`--no-compile-autoload-dotenv`). A compiled CLI must read env from the process environment only, never from an ambient `.env` next to the working directory. See `docs/build-system.md` for the full compile flag rationale.
- `bunfig.toml` autoload is **disabled** in release builds (`--no-compile-autoload-bunfig`). Bun runtime config must not be inherited from the invoking project.
- `tsconfig.json` and `package.json` autoload remain disabled (Bun's default for compiled binaries). The bundler already consumed them at build time.
- `BUN_OPTIONS` is honored at runtime (e.g. `BUN_OPTIONS="--cpu-prof" ./acme ...`). This is a profiling/debug escape hatch, not a configuration channel.
- `BUN_BE_BUN=1` makes the binary impersonate the `bun` CLI itself. This is an upstream Bun feature; document it as a known runtime behavior. Schema-driven code does not execute in this mode.

Schema-declared env vars (via input sources or `env`) are read directly from the process environment and are unaffected by autoload toggles.

## Auth/session env vars

Auth/session generated CLIs add a stricter env contract:

- token env vars such as `ACME_TOKEN` and `ACME_API_KEY` are read by `resolveAuth`, wrapped in `SecretString`, and never exposed in command output, logs, MCP metadata, conformance reports, or release manifests
- context env vars such as `ACME_ORG_ID` and `ACME_PROJECT_ID` are non-secret scoping values and may appear in redacted status metadata when useful
- profile selection may use `<PRODUCT_ENV_PREFIX>_PROFILE`
- raw secret CLI flags such as `--token`, `--api-key`, or `--auth-env NAME=VALUE` are not the primary generated path and must not be emitted by default

Credential resolution order and generated flags are defined in `docs/auth-session.md`.

## Telemetry env vars

`@liche/telemetry` is **opt-in by default** — no events fire until consent is set. Seven env vars govern resolution; a kill at any level wins, an enable at any level requires no higher-level disable. Generated from `packages/extensions/telemetry/src/internal/consent.ts`.

| Name | Purpose | Required | Values |
|---|---|---|---|
| `LICHE_TELEMETRY` | Liche-wide telemetry switch | no | `1\|true\|yes\|on` enables; `0\|false\|off\|no\|''` disables; anything else → disabled |
| `${CLI_NAME_UPPER}_TELEMETRY` | Per-CLI telemetry switch (e.g. `SHIPYARD_TELEMETRY`) | no | same vocabulary |
| `DO_NOT_TRACK` | Universal opt-out (consoledonottrack.com) | no | non-empty and not `0` → kills, overrides per-CLI enable |
| `LICHE_TELEMETRY_CLI` | Per-invocation override for `cli` | no | same vocabulary |
| `LICHE_TELEMETRY_CI` | Per-invocation override for `ci` (default off) | no | same vocabulary |
| `LICHE_TELEMETRY_AGENT` | Per-invocation override for `agent` (default off; catches `cli.fetch()`) | no | same vocabulary |
| `LICHE_TELEMETRY_MCP` | Per-invocation override for `mcp` (default off) | no | same vocabulary |
| `LICHE_TELEMETRY_DEBUG` | When `stderr`, installs a console sink alongside any configured sinks (prints redacted wire events without sending) | no | `stderr` enables; other values ignored |

Precedence (top wins): `DO_NOT_TRACK` → `LICHE_TELEMETRY` → `${CLI}_TELEMETRY` → `LICHE_TELEMETRY_<INVOCATION>`. Any value outside the documented vocabulary is treated as "unset" → disabled.

Telemetry env vars do not participate in `input.sources` or schema-declared `env` — they are read by the extension itself. They are **not** redacted in command output because they are not secrets; the redaction policy applies to event payloads, not to the consent signal.
